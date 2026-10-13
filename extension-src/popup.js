const ORIGIN = "https://social.gershon.ai";

const installedVersion = chrome.runtime.getManifest().version;
const verEl = document.getElementById("ver");
const updateBanner = document.getElementById("update-banner");
const statusEl = document.getElementById("status");
const lastEl = document.getElementById("last-captured");

verEl.textContent = "v" + installedVersion;

function show(msg, kind) {
  statusEl.innerHTML = '<div class="status ' + kind + '">' + msg + '</div>';
}

function relTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

function semverLt(a, b) {
  const pa = a.split(".").map(function (n) { return parseInt(n, 10) || 0; });
  const pb = b.split(".").map(function (n) { return parseInt(n, 10) || 0; });
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return true;
    if ((pa[i] || 0) > (pb[i] || 0)) return false;
  }
  return false;
}

async function checkVersion() {
  try {
    const r = await fetch(ORIGIN + "/api/extension/version", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.success) return;
    if (semverLt(installedVersion, j.data.latest)) {
      updateBanner.innerHTML =
        '<div class="update-banner"><strong>Update available — v' + j.data.latest + '.</strong><br>' +
        (j.data.releaseNotes || "") + "<br>" +
        (j.data.updateInstructions || "Reload the extension in chrome://extensions/.") +
        "</div>";
    }
  } catch (e) {}
}

async function renderLast() {
  const r = await chrome.storage.local.get(["lastCapture", "lastAutoSync", "lastRunDetail"]);
  const last = r.lastCapture || {};
  const autoSync = r.lastAutoSync;
  const detail = r.lastRunDetail;
  const parts = [];
  if (last.LINKEDIN) parts.push("<strong>LinkedIn</strong>: " + relTime(last.LINKEDIN.at));
  if (last.TWITTER) parts.push("<strong>X</strong>: " + relTime(last.TWITTER.at));
  let html = parts.length ? "Last refresh — " + parts.join(" · ") : "";
  if (autoSync && autoSync.at) {
    html += '<div style="margin-top:6px;color:#9ca3af;font-size:11px;">' +
      'Sync ran ' + relTime(autoSync.at) +
      ' · ' + (autoSync.totalUpserted || 0) + ' posts upserted across ' +
      (autoSync.accountCount || 0) + ' accounts' +
      ((autoSync.totalFailed || 0) > 0 ? ' · ' + autoSync.totalFailed + ' failed' : '') +
      '</div>';
  }
  if (detail && Array.isArray(detail.log)) {
    html += '<details style="margin-top:8px;border-top:1px solid #f3f4f6;padding-top:8px;">' +
      '<summary style="cursor:pointer;font-size:11px;color:#3b82f6;">View detailed log (' + detail.log.length + ' steps)</summary>' +
      '<div style="margin-top:6px;max-height:240px;overflow-y:auto;font-family:ui-monospace,monospace;font-size:10px;line-height:1.4;background:#f9fafb;padding:6px;border-radius:4px;">';
    for (const ev of detail.log) {
      const t = new Date(ev.at).toISOString().slice(11, 19);
      const stepColor = ev.step.includes("FAILED") ? "#dc2626"
        : ev.step.includes("OK") || ev.step === "run:done" ? "#059669"
        : "#374151";
      html += '<div style="margin-bottom:4px;"><span style="color:#9ca3af;">' + t + '</span> ' +
        '<strong style="color:' + stepColor + ';">' + ev.step + '</strong>';
      if (ev.detail) {
        html += '<div style="margin-left:12px;color:#6b7280;">' + escapeHtml(JSON.stringify(ev.detail)) + '</div>';
      }
      html += '</div>';
    }
    html += '</div></details>';
  }
  lastEl.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

// Listen for progress events streamed from the background service worker.
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "sync-progress") {
    show(msg.text, msg.kind || "info");
  }
});

document.getElementById("sync-now").addEventListener("click", async function (e) {
  const btn = e.currentTarget || document.getElementById("sync-now");
  btn.disabled = true;
  show("Starting sync in background…", "info");

  // Delegate to the service worker so the popup can close mid-sync without
  // aborting the run. The service worker streams progress events back via
  // chrome.runtime.sendMessage("sync-progress").
  chrome.runtime.sendMessage({ type: "manual-sync" }, function (response) {
    btn.disabled = false;
    if (chrome.runtime.lastError) {
      show("Background sync failed: " + chrome.runtime.lastError.message, "err");
      renderLast();
      return;
    }
    if (!response || !response.ok) {
      show("Sync error: " + ((response && response.error) || "unknown"), "err");
      renderLast();
      return;
    }
    const r = response.result || {};
    let msg = "✓ " + (r.totalUpserted || 0) + " posts upserted across " + (r.accountCount || 0) + " accounts";
    if ((r.totalFailed || 0) > 0) msg += " · " + r.totalFailed + " failed";
    if ((r.badPlatforms || []).length > 0) msg += " · cookie issues: " + r.badPlatforms.join(", ");
    if ((r.ingestErrors || []).length > 0) msg += " · ingest errors: " + r.ingestErrors.join(", ");
    show(msg, (r.totalUpserted || 0) > 0 ? "ok" : "err");
    renderLast();
  });
});

renderLast();
checkVersion();
