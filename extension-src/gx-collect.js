// Background collection — works on its own, out of your way. (extension 0.13.0)
//
// Same approach as the Linalysis extension, which collects in the background:
//
// 1. A SEPARATE, UNFOCUSED WINDOW. Before 0.13.0 the collector opened LinkedIn
//    and X as hidden tabs in the window you were using, then brought the X tab
//    to the front when it finished. A hidden tab is "not visible" to the page,
//    so LinkedIn often rendered nothing — and the tab jumping forward took over
//    your screen. Now every collection tab opens in its own window that never
//    takes focus; the page being scraped is the front tab of THAT window, so it
//    renders normally. The window closes itself when the run ends.
// 2. CATCH-UP. If Chrome was closed when the daily run was due, or the last good
//    run is more than 26 hours old, it collects at startup and on a 3-hourly
//    check — it no longer waits for the next day.
// 3. STARTS ON ITS OWN. As soon as the extension is connected to a workspace
//    (gx-bridge.js, from a signed-in dashboard tab) and has never collected, it
//    runs a first collection a minute later.
// 4. STAYS AWAKE. Chrome puts an idle extension to sleep after ~30 seconds; a
//    run waits on pages for longer than that, so it pings Chrome while running.
// 5. ONE RUN AT A TIME. Runs queue instead of overlapping.
//
// Loaded by gx-boot.js after background.js; it wraps self.runFullSync, so the
// daily alarm, the popup's Sync Now and the dashboard's "Collect" button all
// get the same behaviour. sync-core.js itself is untouched.

(function () {
  var HEARTBEAT_ALARM = "social-heartbeat";
  var FIRST_RUN_ALARM = "social-first-run";
  var STALE_AFTER_H = 26;
  var WIN_KEY = "collectWindowId";

  var win = { id: null, prevFocused: null };
  var running = 0;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ── The collection window ──────────────────────────────────────────────
  async function closeWindow(id) {
    if (!id) return;
    try { await chrome.windows.remove(id); } catch (e) {}
  }

  async function openWindow() {
    try { var f = await chrome.windows.getLastFocused(); win.prevFocused = f && f.id; } catch (e) { win.prevFocused = null; }
    var w = await chrome.windows.create({
      url: "about:blank", focused: false, type: "normal",
      width: 1280, height: 900, top: 0, left: 0
    });
    win.id = w.id;
    try { await chrome.storage.local.set({ collectWindowId: w.id }); } catch (e) {}
    if (win.prevFocused) { try { await chrome.windows.update(win.prevFocused, { focused: true }); } catch (e) {} }
    return w;
  }

  // A window left behind by a run the browser cut short.
  async function closeLeftover() {
    try {
      var r = await chrome.storage.local.get(WIN_KEY);
      if (r && r[WIN_KEY] && r[WIN_KEY] !== win.id) await closeWindow(r[WIN_KEY]);
    } catch (e) {}
  }

  // Tabs the collector opens go to the collection window, as its front tab.
  var nativeCreate = chrome.tabs.create.bind(chrome.tabs);
  var nativeUpdate = chrome.tabs.update.bind(chrome.tabs);
  chrome.tabs.create = async function (props) {
    if (!running || !win.id) return nativeCreate(props);
    var p = Object.assign({}, props, { windowId: win.id, active: true });
    try { return await nativeCreate(p); } catch (e) { return nativeCreate(props); }
  };
  // When a collection tab is pointed at a new page, bring it to the front of
  // its own window first, so that page is the visible one.
  chrome.tabs.update = async function (tabId, props) {
    if (running && win.id && typeof tabId === "number" && props && props.url) {
      try {
        var t = await chrome.tabs.get(tabId);
        if (t && t.windowId === win.id) await nativeUpdate(tabId, { active: true });
      } catch (e) {}
    }
    return nativeUpdate(tabId, props);
  };

  // ── Keep the service worker awake during a run ─────────────────────────
  var keepAlive = null;
  function startKeepAlive() {
    if (keepAlive) return;
    keepAlive = setInterval(function () { try { chrome.runtime.getPlatformInfo(function () {}); } catch (e) {} }, 20000);
  }
  function stopKeepAlive() { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }

  // ── One run at a time, every run in the collection window ──────────────
  var originalRun = self.runFullSync;
  var queue = Promise.resolve();

  async function bound() {
    try { var r = await chrome.storage.local.get("workspaceToken"); return !!(r && r.workspaceToken); } catch (e) { return false; }
  }

  async function guardedRun(opts) {
    if (!(await bound())) {
      return { ok: false, totalUpserted: 0, totalFailed: 0, accountCount: 0, badPlatforms: [],
        ingestErrors: ["Not connected to a workspace. Open social.gershoncrm.com in this browser and sign in."] };
    }
    running++;
    startKeepAlive();
    await closeLeftover();
    var result;
    try {
      if (!win.id) await openWindow();
      result = await originalRun(opts);
    } finally {
      running--;
      if (!running) {
        var id = win.id;
        win.id = null;
        await sleep(500);
        await closeWindow(id);
        try { await chrome.storage.local.remove(WIN_KEY); } catch (e) {}
        stopKeepAlive();
      }
    }
    if (result && result.ok && !(opts && opts.clientIdFilter)) {
      try { await chrome.storage.local.set({ lastSuccessAt: Date.now() }); } catch (e) {}
    }
    return result;
  }

  self.runFullSync = function (opts) {
    var p = queue.then(function () { return guardedRun(opts); });
    queue = p.catch(function () {});
    return p;
  };

  // ── Catch-up and first run ─────────────────────────────────────────────
  async function staleHours() {
    try {
      var r = await chrome.storage.local.get("lastSuccessAt");
      return r && r.lastSuccessAt ? (Date.now() - r.lastSuccessAt) / 3600000 : Infinity;
    } catch (e) { return Infinity; }
  }

  async function catchUp(trigger) {
    if (running || !(await bound())) return;
    if ((await staleHours()) < STALE_AFTER_H) return;
    try { chrome.action.setBadgeText({ text: "…" }); } catch (e) {}
    var res = null;
    try { res = await self.runFullSync({ origin: "https://social.gershoncrm.com", onProgress: function () {}, trigger: trigger }); } catch (e) {}
    try { chrome.action.setBadgeText({ text: res && res.ok ? "✓" : "!" }); } catch (e) {}
  }

  async function ensureAlarms() {
    try {
      var h = await chrome.alarms.get(HEARTBEAT_ALARM);
      if (!h) await chrome.alarms.create(HEARTBEAT_ALARM, { delayInMinutes: 5, periodInMinutes: 180 });
    } catch (e) {}
  }

  chrome.runtime.onInstalled.addListener(function () { ensureAlarms(); closeLeftover(); });
  chrome.runtime.onStartup.addListener(function () {
    ensureAlarms();
    closeLeftover();
    // Give Chrome a moment to restore its windows and sessions first.
    try { chrome.alarms.create(FIRST_RUN_ALARM, { delayInMinutes: 2 }); } catch (e) {}
  });
  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === HEARTBEAT_ALARM) { ensureAlarms(); catchUp("heartbeat"); }
    if (alarm.name === FIRST_RUN_ALARM) catchUp("startup");
  });

  // Just connected to a workspace and never collected → start in a minute.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local" || !changes.workspaceToken || !changes.workspaceToken.newValue) return;
    if (changes.workspaceToken.oldValue === changes.workspaceToken.newValue) return;
    // A different workspace starts from scratch: its first collection is due now.
    try { chrome.storage.local.remove("lastSuccessAt"); } catch (e) {}
    try { chrome.alarms.create(FIRST_RUN_ALARM, { delayInMinutes: 1 }); } catch (e) {}
  });

  ensureAlarms();
})();
