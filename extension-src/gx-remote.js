// Background work on request (extension 0.19.0) — the Linalysis pattern.
//
// Every minute this install asks social.gershon.ai "is there a collection for
// me?" (/api/extension/collect/next). The dashboard puts requests there when
// someone presses "Collect" — from any browser, a phone included, with no
// dashboard tab needed in this Chrome. The first free install takes the job
// (the server hands each job to exactly one browser), collects in its own
// unfocused window (gx-collect.js), and reports the result
// (/api/extension/collect/result). The same check-in tells the dashboard
// which Chromes are listening and which extension version each one runs.
//
// It never runs while another collection is in progress — it waits for the
// next minute — and only once this install is bound to a workspace
// (a client's publishing key, gp_…, never collects).
//
// Loaded LAST by gx-boot.js, so self.runFullSync is gx-collect.js's guarded
// version (own window, one run at a time, keep-alive).
(function () {
  var API = "https://social.gershon.ai/api/extension/collect";
  var TICK_ALARM = "remote-collect-tick";
  var AGENT_KEY = "agentId";
  var busy = false;

  function version() { try { return chrome.runtime.getManifest().version; } catch (e) { return "?"; } }

  async function agentId() {
    try {
      var r = await chrome.storage.local.get(AGENT_KEY);
      if (r && r[AGENT_KEY]) return r[AGENT_KEY];
      var id = "ag_" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : String(Date.now()) + Math.random().toString(36).slice(2, 8));
      await chrome.storage.local.set({ [AGENT_KEY]: id });
      return id;
    } catch (e) { return null; }
  }

  async function label() {
    var os = "";
    try { var p = await chrome.runtime.getPlatformInfo(); os = { win: "Windows", mac: "Mac", linux: "Linux", cros: "ChromeOS" }[p.os] || p.os; } catch (e) {}
    return "Chrome" + (os ? " on " + os : "");
  }

  async function bound() {
    try {
      var r = await chrome.storage.local.get("workspaceToken");
      var t = (r && r.workspaceToken) || "";
      return !!t && t.indexOf("gp_") !== 0;
    } catch (e) { return false; }
  }

  async function report(job, agent, res, err) {
    var body = {
      id: job.id,
      agent: agent,
      ok: !!(res && res.ok) && !err,
      totalUpserted: (res && res.totalUpserted) || 0,
      totalFailed: (res && res.totalFailed) || 0,
      accountCount: (res && res.accountCount) || 0,
      errors: err ? [err] : ((res && res.ingestErrors) || []).concat((res && res.badPlatforms || []).map(function (p) { return "Not signed in to " + p; })),
    };
    for (var i = 0; i < 3; i++) {
      try {
        var r = await fetch(API + "/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (r.ok || r.status === 404) return;
      } catch (e) {}
      await new Promise(function (ok) { setTimeout(ok, 5000); });
    }
  }

  async function tick() {
    if (busy) return;
    if (typeof self.gxCollectRunning === "function" && self.gxCollectRunning()) return;
    if (!(await bound())) return;
    var agent = await agentId();
    if (!agent) return;
    busy = true;
    try {
      var url = API + "/next?agent=" + encodeURIComponent(agent) + "&v=" + encodeURIComponent(version()) + "&label=" + encodeURIComponent(await label());
      var r = await fetch(url);
      if (!r.ok) return;
      var j = await r.json().catch(function () { return null; });
      var job = j && j.data && j.data.job;
      if (!job) return;
      try { chrome.action.setBadgeText({ text: "…" }); } catch (e) {}
      var res = null, err = null;
      try {
        res = await self.runFullSync({
          origin: "https://social.gershon.ai",
          clientIdFilter: job.clientId || undefined,
          trigger: "remote",
          onProgress: function () {},
        });
      } catch (e) { err = (e && e.message) || String(e); }
      try { chrome.action.setBadgeText({ text: res && res.ok && !err ? "✓" : "!" }); } catch (e) {}
      await report(job, agent, res, err);
    } catch (e) {
      // Offline or the dashboard is down: try again next minute.
    } finally {
      busy = false;
    }
  }

  function ensureAlarm() {
    try {
      chrome.alarms.get(TICK_ALARM, function (a) {
        if (!a) chrome.alarms.create(TICK_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
      });
    } catch (e) {}
  }

  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === TICK_ALARM) return tick();
  });
  chrome.runtime.onInstalled.addListener(ensureAlarm);
  chrome.runtime.onStartup.addListener(ensureAlarm);
  ensureAlarm();

  // For tests, the popup and gx-update.js.
  self.gxRemoteTick = tick;
  self.gxRemoteBusy = function () { return busy; };
})();
