// Workspace binding — automatic. (extension 0.12.0)
//
// Runs on social.gershoncrm.com pages. Asks the dashboard, with the page's own
// sign-in, which workspace the signed-in person belongs to, and stores that
// workspace's token. From then on everything this browser collects goes to
// THAT workspace and no other.
//
// Why: until 0.12.0 an install with no token was silently handed the original
// (Gershon) workspace. A fresh install for another customer therefore
// collected Gershon's clients. Now there is no fallback anywhere — an install
// that has never seen a signed-in dashboard tab is bound to nothing and
// collects nothing — and binding needs no paste, no step, no choice.
//
// Signed out → the current binding is kept. A different person signs in →
// the binding follows them.

(function () {
  function bind() {
    fetch("/api/extension/bind", { credentials: "include", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.success || !j.data || !j.data.token) return;
        var d = j.data;
        chrome.storage.local.get(["workspaceToken", "workspaceId"], function (cur) {
          var changed = cur.workspaceToken !== d.token || cur.workspaceId !== d.workspaceId;
          chrome.storage.local.set({
            workspaceToken: d.token,
            workspaceId: d.workspaceId,
            workspaceName: d.workspaceName || "",
            workspaceEmail: d.email || "",
            workspaceBoundAt: new Date().toISOString(),
          }, function () {
            try {
              window.postMessage(
                { type: "GERSHONAI_BOUND", workspaceName: d.workspaceName, changed: changed },
                location.origin
              );
            } catch (e) {}
          });
        });
      })
      .catch(function () {});
  }
  bind();
  // Re-check when the tab comes back into view (someone may have switched account).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") bind();
  });
})();
