// Workspace token — what tells social.gershoncrm.com whose data this is.
//
// One extension, many customers. The token is set AUTOMATICALLY by
// gx-bridge.js from the dashboard tab you are signed in to (0.12.0). Every
// call to the dashboard carries it. With no token, calls to the dashboard are
// refused right here, before they leave the browser — there is no "original
// workspace" fallback any more, on either side.
//
// It works by wrapping fetch rather than by editing sync-core.js, so the
// scrape logic is untouched. Requests to linkedin.com and x.com are passed
// through unchanged; the token goes nowhere near them.
//
// Loaded first in both contexts: gx-boot.js for the service worker, a script
// tag ahead of popup.js in popup.html.

(function () {
  var API_ORIGIN = "https://social.gershoncrm.com";
  var STORAGE_KEY = "workspaceToken";

  var cached = null;      // string | "" once read
  var pending = null;     // in-flight read

  function readToken() {
    if (cached !== null) return Promise.resolve(cached);
    if (pending) return pending;
    pending = new Promise(function (resolve) {
      try {
        chrome.storage.local.get(STORAGE_KEY, function (r) {
          cached = (r && r[STORAGE_KEY]) || "";
          pending = null;
          resolve(cached);
        });
      } catch (e) {
        cached = "";
        pending = null;
        resolve("");
      }
    });
    return pending;
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes[STORAGE_KEY]) {
        cached = changes[STORAGE_KEY].newValue || "";
      }
    });
  } catch (e) {}

  // ---- fetch wrapper -------------------------------------------------------

  var nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf(API_ORIGIN) !== 0) return nativeFetch(input, init);

    var token = await readToken();
    if (!token) {
      // The version check is public and harmless; everything else needs a workspace.
      if (url.indexOf(API_ORIGIN + "/api/extension/version") === 0) return nativeFetch(input, init);
      return new Response(
        JSON.stringify({
          success: false,
          code: "token_required",
          error: "Not connected to a workspace. Open social.gershoncrm.com in this browser and sign in — the extension connects itself.",
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }

    var opts = Object.assign({}, init || {});
    var headers = new Headers((init && init.headers) || (input && input.headers) || {});
    headers.set("x-gershon-token", token);
    opts.headers = headers;
    return nativeFetch(url, opts);
  };

  // ---- popup UI ------------------------------------------------------------
  // Shows, in plain words, which workspace this browser collects for.

  if (typeof document === "undefined") return;

  document.addEventListener("DOMContentLoaded", function () {
    var host = document.querySelector(".footer");
    if (!host) return;

    var wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px;padding:10px;border-radius:8px;font-size:12px;line-height:1.45;";

    function render(r) {
      var token = r && r.workspaceToken;
      wrap.innerHTML = "";
      var title = document.createElement("div");
      title.style.cssText = "font-weight:700;margin-bottom:2px;";
      var detail = document.createElement("div");
      if (token) {
        wrap.style.background = "#ecfdf5";
        wrap.style.border = "1px solid #a7f3d0";
        title.style.color = "#065f46";
        title.textContent = "Collecting for: " + (r.workspaceName || "your workspace");
        detail.style.color = "#047857";
        detail.textContent = r.workspaceEmail
          ? "Connected as " + r.workspaceEmail + ". Only this workspace's companies are collected."
          : "Only this workspace's companies are collected.";
      } else {
        wrap.style.background = "#fef2f2";
        wrap.style.border = "1px solid #fecaca";
        title.style.color = "#991b1b";
        title.textContent = "Not connected — nothing will be collected";
        detail.style.color = "#b91c1c";
        detail.textContent =
          "Open social.gershoncrm.com in this browser and sign in. The extension connects itself to your workspace.";
      }
      wrap.appendChild(title);
      wrap.appendChild(detail);
    }

    chrome.storage.local.get(
      ["workspaceToken", "workspaceName", "workspaceEmail"],
      render
    );
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "local") return;
        if (changes.workspaceToken || changes.workspaceName || changes.workspaceEmail) {
          chrome.storage.local.get(["workspaceToken", "workspaceName", "workspaceEmail"], render);
        }
      });
    } catch (e) {}

    host.parentNode.insertBefore(wrap, host);
  });
})();
