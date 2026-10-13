// GershonAI extension background service worker (v0.10.0).
//
// Two jobs:
//   1. Daily auto-sync — chrome.alarms fires once a day. We run runFullSync()
//      inline (it can open tabs and use chrome.scripting from a service worker
//      in MV3). This is what makes the system "work behind the scene" — as
//      long as Chrome is running, the dashboard gets fresh data every day
//      without the user clicking anything.
//   2. On-install bootstrap — set the badge color and create the alarm.
//
// When Chrome is closed all day, the alarm fires whenever Chrome next opens.
// If even that misses, the server-side cron at 06:00 UTC will detect a stale
// PlatformConnection.lastSyncAt and fall back to Phantombuster.

importScripts("sync-core.js");

const ORIGIN = "https://social.gershon.ai";
const ALARM_NAME = "gershonai-daily-sync";
// 1440 minutes = 24 hours. We pick 1430 instead of 1440 so the alarm time
// drifts forward ~10 min each day, eventually covering all hours so we'd
// catch a missed window even on a user who only ever opens Chrome in the
// afternoon. Cheap belt-and-suspenders.
const DAILY_PERIOD_MIN = 1430;
// First fire 15 minutes after install/update. After that, the period kicks
// in and it fires every ~24h.
const FIRST_FIRE_DELAY_MIN = 15;

chrome.runtime.onInstalled.addListener(async function () {
  try { chrome.action.setBadgeBackgroundColor({ color: "#10b981" }); } catch (e) {}
  try {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: FIRST_FIRE_DELAY_MIN,
      periodInMinutes: DAILY_PERIOD_MIN
    });
  } catch (e) {}
});

// In case the service worker is restarted but the alarm somehow got cleared
// (Chrome occasionally GCs alarms in certain edge cases), re-create on every
// startup. chrome.alarms.create is idempotent for the same name + parameters.
chrome.runtime.onStartup.addListener(async function () {
  try {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing) {
      await chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: FIRST_FIRE_DELAY_MIN,
        periodInMinutes: DAILY_PERIOD_MIN
      });
    }
  } catch (e) {}
});

chrome.alarms.onAlarm.addListener(async function (alarm) {
  if (alarm.name !== ALARM_NAME) return;
  try {
    chrome.action.setBadgeText({ text: "…" });
  } catch (e) {}
  let result = null;
  try {
    result = await self.runFullSync({
      origin: ORIGIN,
      onProgress: function () {} // headless — no UI for background runs
    });
  } catch (e) {
    result = { ok: false, totalUpserted: 0, totalFailed: 1, accountCount: 0, badPlatforms: [], ingestErrors: ["background: " + ((e && e.message) || String(e))] };
  }
  try {
    if (result && result.ok && (result.totalUpserted > 0 || result.accountCount > 0)) {
      chrome.action.setBadgeText({ text: "✓" });
    } else {
      chrome.action.setBadgeText({ text: "!" });
    }
  } catch (e) {}
  // Clear the badge after 1 hour so it doesn't linger forever.
  setTimeout(function () { try { chrome.action.setBadgeText({ text: "" }); } catch (e) {} }, 60 * 60 * 1000);
});

// Allow the popup (or devtools) to trigger a manual sync via runtime messages.
// Used by popup.js's "Sync Now" button — popup sends { type: "manual-sync" }
// and we run the shared core. This keeps the popup window able to close
// mid-sync without aborting the run, since the work happens in the service
// worker.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === "manual-sync") {
    self.runFullSync({
      origin: ORIGIN,
      onProgress: function (text, kind) {
        try { chrome.runtime.sendMessage({ type: "sync-progress", text: text, kind: kind }); } catch (e) {}
      }
    }).then(function (result) {
      sendResponse({ ok: true, result: result });
    }).catch(function (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    });
    return true; // keep channel open for async sendResponse
  }

  // Per-client sync triggered from the social.gershon.ai page via the
  // content script's postMessage bridge. We run runFullSync with a
  // clientIdFilter so only that one client's LinkedIn + X accounts get
  // scraped.
  if (msg && msg.type === "sync-client" && msg.clientId) {
    self.runFullSync({
      origin: ORIGIN,
      clientIdFilter: msg.clientId,
      onProgress: function () {}
    }).then(function (result) {
      sendResponse({ ok: true, result: result });
    }).catch(function (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    });
    return true;
  }
});
