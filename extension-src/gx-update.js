// Updates itself (extension 0.20.0).
//
// The extension is installed from a folder on the computer ("Load unpacked").
// Until now a new version meant someone opening chrome://extensions and pressing
// the reload arrow. Now, every 10 minutes, the extension reads the version of
// the files in its own folder. When the folder holds a newer version — and the
// same newer version was already there at the previous check, so a copy still
// in progress is never picked up — it reloads itself, but only when nothing is
// running (no collection, no publishing, no background job).
//
// The new files still have to be put in the folder (Claude does that through
// the desktop app; the download on social.gershon.ai works too).
(function () {
  var ALARM = "self-update-check";
  var SEEN_KEY = "diskVersionSeen";

  function newer(a, b) {
    var pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  function busy() {
    try { if (typeof self.gxCollectRunning === "function" && self.gxCollectRunning()) return true; } catch (e) {}
    try { if (typeof self.gxPublishing === "function" && self.gxPublishing()) return true; } catch (e) {}
    try { if (typeof self.gxRemoteBusy === "function" && self.gxRemoteBusy()) return true; } catch (e) {}
    return false;
  }

  async function diskVersion() {
    try {
      var r = await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" });
      var m = await r.json();
      return m && m.version ? String(m.version) : null;
    } catch (e) { return null; }   // half-written or unreadable: wait for the next check
  }

  async function check() {
    var running = chrome.runtime.getManifest().version;
    var disk = await diskVersion();
    if (!disk || !newer(disk, running)) {
      try { await chrome.storage.local.remove(SEEN_KEY); } catch (e) {}
      return { running: running, disk: disk, reload: false };
    }
    var seen = null;
    try { var s = await chrome.storage.local.get(SEEN_KEY); seen = s && s[SEEN_KEY]; } catch (e) {}
    if (seen !== disk) {
      try { await chrome.storage.local.set({ [SEEN_KEY]: disk }); } catch (e) {}
      return { running: running, disk: disk, reload: false, why: "first sighting — confirm at next check" };
    }
    if (busy()) return { running: running, disk: disk, reload: false, why: "busy" };
    try { await chrome.storage.local.remove(SEEN_KEY); } catch (e) {}
    try { await chrome.storage.local.set({ selfUpdatedAt: Date.now(), selfUpdatedFrom: running, selfUpdatedTo: disk }); } catch (e) {}
    chrome.runtime.reload();
    return { running: running, disk: disk, reload: true };
  }

  function ensureAlarm() {
    try {
      chrome.alarms.get(ALARM, function (a) {
        if (!a) chrome.alarms.create(ALARM, { delayInMinutes: 2, periodInMinutes: 10 });
      });
    } catch (e) {}
  }
  chrome.alarms.onAlarm.addListener(function (alarm) { if (alarm.name === ALARM) return check(); });
  chrome.runtime.onInstalled.addListener(ensureAlarm);
  chrome.runtime.onStartup.addListener(ensureAlarm);
  ensureAlarm();

  self.gxSelfUpdateCheck = check;
})();
