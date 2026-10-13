// Content script — runs on https://social.gershon.ai/*
// Bridges window.postMessage from the page <-> chrome.runtime to the
// background service worker. The page initiates a sync via:
//
//   window.postMessage({ type: "GERSHONAI_SYNC_CLIENT", clientId, requestId }, location.origin);
//
// We forward to background, then post the result back to the page as:
//
//   window.postMessage({ type: "GERSHONAI_SYNC_RESULT", requestId, ok, ... }, location.origin);
//
// Also exposes a heartbeat: page can postMessage GERSHONAI_PING and we
// reply GERSHONAI_PONG so the page can detect the extension is installed.

(function () {
  // Tell the page we're here. The page may already have rendered before
  // the content script ran, so the page should listen AND also post a
  // GERSHONAI_PING on mount.
  window.postMessage({ type: "GERSHONAI_HELLO", version: chrome.runtime.getManifest().version }, location.origin);

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "GERSHONAI_PING") {
      window.postMessage({ type: "GERSHONAI_PONG", version: chrome.runtime.getManifest().version, requestId: data.requestId }, location.origin);
      return;
    }

    if (data.type === "GERSHONAI_SYNC_CLIENT") {
      const requestId = data.requestId;
      const clientId = data.clientId;
      // Hand off to the service worker.
      chrome.runtime.sendMessage(
        { type: "sync-client", clientId: clientId, requestId: requestId },
        function (response) {
          if (chrome.runtime.lastError) {
            window.postMessage({
              type: "GERSHONAI_SYNC_RESULT",
              requestId: requestId,
              ok: false,
              error: chrome.runtime.lastError.message || "Extension messaging error",
            }, location.origin);
            return;
          }
          window.postMessage({
            type: "GERSHONAI_SYNC_RESULT",
            requestId: requestId,
            ok: !!(response && response.ok),
            error: response && response.error,
            result: response && response.result,
          }, location.origin);
        }
      );
    }
  });
})();
