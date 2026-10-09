// LinkedIn session watchdog. (extension 0.14.0)
//
// LinkedIn signs this browser out several times a week. Until now nobody knew
// until a report came back empty. This file notices within seconds and gets
// a human to sign back in:
//
//   1. It watches the li_at cookie — LinkedIn's sign-in cookie — in THIS
//      browser's own cookie jar. No request is sent to LinkedIn to check:
//      the watchdog adds zero LinkedIn traffic.
//   2. When li_at disappears (and is not just being rotated), it waits 15 s,
//      re-checks, and if the browser is really signed out it:
//        - speaks an alert out loud (chrome.tts — needs no click, unlike a
//          web page's speechSynthesis), naming the project and the task;
//        - opens linkedin.com/login in the window you are using, so the
//          password manager (1Password) can fill it in one click;
//        - shows a desktop notification and a red "IN" badge;
//        - tells social.gershoncrm.com, which emails the person once.
//      The voice repeats every 10 minutes, at most 6 times, while signed out.
//   3. When li_at comes back, everything clears and the server is told.
//
// It never types a password and never submits the login form. Signing in
// stays with a person.
//
// Only runs once this install is bound to a workspace (gx-bridge.js), so a
// stray install collecting for nobody stays quiet.
//
// Loaded BEFORE gx-collect.js (see gx-boot.js) so the login tab uses the real
// chrome.tabs.create — gx-collect routes tabs it does not own into its
// unfocused collection window during a run, which is the last place a login
// page should go.

(function () {
  var API = "https://social.gershoncrm.com/api/extension/linkedin-session";
  var LOGIN_URL = "https://www.linkedin.com/login";
  var STATE_KEY = "liWatch";
  var NAG_ALARM = "li-watch-nag";
  var CHECK_ALARM = "li-watch-check";
  var NAG_EVERY_MIN = 10;
  var NAG_MAX = 6;
  var SETTLE_MS = 15000;
  var DEFAULT_VOICE = "LinkedIn signed you out. Please sign back in.";

  var nativeCreate = chrome.tabs.create.bind(chrome.tabs);
  var settleTimer = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function getState() {
    try { var r = await chrome.storage.local.get(STATE_KEY); return (r && r[STATE_KEY]) || {}; }
    catch (e) { return {}; }
  }
  async function setState(patch) {
    var s = Object.assign(await getState(), patch);
    try { await chrome.storage.local.set({ [STATE_KEY]: s }); } catch (e) {}
    return s;
  }

  async function bound() {
    try { var r = await chrome.storage.local.get(["workspaceToken", "workspaceEmail"]); return r && r.workspaceToken ? r : null; }
    catch (e) { return null; }
  }

  async function signedIn() {
    var urls = ["https://www.linkedin.com/", "https://linkedin.com/"];
    for (var i = 0; i < urls.length; i++) {
      try {
        var c = await chrome.cookies.get({ url: urls[i], name: "li_at" });
        if (c && c.value) return true;
      } catch (e) {}
    }
    return false;
  }

  // ── Alerting ────────────────────────────────────────────────────────────
  function pickVoice() {
    return new Promise(function (resolve) {
      try {
        chrome.tts.getVoices(function (voices) {
          voices = voices || [];
          var v = voices.find(function (x) { return /zira/i.test(x.voiceName || ""); }) ||
                  voices.find(function (x) { return /^en/i.test(x.lang || ""); });
          resolve(v ? v.voiceName : null);
        });
      } catch (e) { resolve(null); }
    });
  }

  async function speak(text) {
    var name = await pickVoice();
    var opts = { rate: 0.95, enqueue: false };
    if (name) opts.voiceName = name;
    try { chrome.tts.speak(text, opts); } catch (e) {}
  }

  function badgeOut() {
    try {
      chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
      chrome.action.setBadgeText({ text: "IN" });
      chrome.action.setTitle({ title: "LinkedIn signed you out — sign back in" });
    } catch (e) {}
  }
  function badgeClear() {
    try {
      chrome.action.getBadgeText({}, function (t) { if (t === "IN") chrome.action.setBadgeText({ text: "" }); });
      chrome.action.setTitle({ title: "Social by Gershon.AI — Sync" });
    } catch (e) {}
  }

  async function openLoginTab() {
    var s = await getState();
    if (s.loginTabId != null) {
      try {
        var t = await chrome.tabs.get(s.loginTabId);
        if (t && /linkedin\.com/.test(t.url || t.pendingUrl || "")) {
          await chrome.tabs.update(t.id, { active: true });
          await chrome.windows.update(t.windowId, { focused: true });
          return;
        }
      } catch (e) {}
    }
    var props = { url: LOGIN_URL, active: true };
    try {
      var w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      var collect = (await chrome.storage.local.get("collectWindowId")).collectWindowId;
      if (w && w.id !== collect) props.windowId = w.id;
    } catch (e) {}
    try {
      var tab = await nativeCreate(props);
      await setState({ loginTabId: tab.id });
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
    } catch (e) {}
  }

  function notify() {
    try {
      chrome.notifications.create("li-watch", {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "LinkedIn signed you out",
        message: "LinkedIn tools are paused. The login page is open — sign back in.",
        priority: 2,
        requireInteraction: true
      });
    } catch (e) {}
  }

  async function report(state) {
    var b = await bound();
    try {
      var r = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: state, at: new Date().toISOString(), email: (b && b.workspaceEmail) || null })
      });
      var j = await r.json().catch(function () { return null; });
      if (j && j.success && j.data && j.data.voice) await setState({ voice: j.data.voice });
    } catch (e) {}
  }

  // ── Transitions ─────────────────────────────────────────────────────────
  async function onSignedOut() {
    var s = await getState();
    if (s.state === "out") return; // already handled this sign-out
    await setState({ state: "out", since: new Date().toISOString(), nags: 1, loginTabId: null });
    badgeOut();
    await report("signed_out");          // fetches the personalised sentence
    s = await getState();
    await speak(s.voice || DEFAULT_VOICE);
    await openLoginTab();
    notify();
    try { chrome.alarms.create(NAG_ALARM, { delayInMinutes: NAG_EVERY_MIN, periodInMinutes: NAG_EVERY_MIN }); } catch (e) {}
  }

  async function onSignedIn() {
    var s = await getState();
    if (s.state === "in") return;
    var wasOut = s.state === "out";
    await setState({ state: "in", since: new Date().toISOString(), nags: 0, loginTabId: null });
    try { await chrome.alarms.clear(NAG_ALARM); } catch (e) {}
    try { chrome.notifications.clear("li-watch"); } catch (e) {}
    badgeClear();
    if (wasOut) await report("signed_in");
  }

  async function check() {
    if (!(await bound())) return;
    if (await signedIn()) await onSignedIn();
    else await onSignedOut();
  }

  // ── Wiring (top level, so the service worker re-registers on wake) ──────
  chrome.cookies.onChanged.addListener(function (info) {
    var c = info && info.cookie;
    if (!c || c.name !== "li_at" || !/linkedin\.com$/i.test((c.domain || "").replace(/^\./, ""))) return;
    if (!info.removed) { check(); return; }                  // signed (back) in
    if (info.cause === "overwrite" || info.cause === "expired_overwrite") return; // rotation, not a sign-out
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { settleTimer = null; check(); }, SETTLE_MS);
  });

  chrome.alarms.onAlarm.addListener(async function (alarm) {
    if (alarm.name === CHECK_ALARM) { check(); return; }
    if (alarm.name !== NAG_ALARM) return;
    if (await signedIn()) { await onSignedIn(); return; }
    var s = await getState();
    if ((s.nags || 0) >= NAG_MAX) { try { await chrome.alarms.clear(NAG_ALARM); } catch (e) {} return; }
    await setState({ nags: (s.nags || 0) + 1 });
    badgeOut();
    await speak(s.voice || DEFAULT_VOICE);
    await openLoginTab();
  });

  try {
    chrome.notifications.onClicked.addListener(function (id) { if (id === "li-watch") openLoginTab(); });
  } catch (e) {}

  // Safety net for anything the cookie event misses (browser started already
  // signed out, an event dropped while the worker slept): a cheap local
  // check every 30 minutes. Reads the cookie jar only.
  function ensureCheckAlarm() {
    try {
      chrome.alarms.get(CHECK_ALARM, function (a) {
        if (!a) chrome.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
      });
    } catch (e) {}
  }
  chrome.runtime.onInstalled.addListener(ensureCheckAlarm);
  chrome.runtime.onStartup.addListener(ensureCheckAlarm);
  ensureCheckAlarm();

  // Popup / devtools hook: { type: "li-watch-test" } runs the full alert once.
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "li-watch-test") {
      getState().then(function (s) { return speak(s.voice || DEFAULT_VOICE); }).then(function () { sendResponse({ ok: true }); });
      return true;
    }
    if (msg && msg.type === "li-watch-status") {
      Promise.all([getState(), signedIn()]).then(function (r) { sendResponse({ ok: true, state: r[0], signedIn: r[1] }); });
      return true;
    }
  });

  self.liWatch = { check: check, signedIn: signedIn };
})();
