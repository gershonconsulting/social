// Workspace token — what tells social.gershoncrm.com whose data this is.
//
// One extension, many customers. The build is identical everywhere; the token
// pasted into it decides which workspace the clients it fetches come from and
// which workspace the posts it collects are written to. Without one, the
// server still falls back to the original workspace, which is a grace period
// for installs that predate this file and not something to rely on.
//
// It works by wrapping fetch rather than by editing sync-core.js. Every call
// to the dashboard already goes through fetch, so wrapping it once here
// catches all of them — the cookie save, the client list, the ingest — and
// leaves the scrape logic completely untouched. Requests to linkedin.com and
// x.com are passed through unchanged; the token goes nowhere near them.
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
    if (!token) return nativeFetch(input, init);

    var opts = Object.assign({}, init || {});
    var headers = new Headers((init && init.headers) || (input && input.headers) || {});
    headers.set("x-gershon-token", token);
    opts.headers = headers;
    return nativeFetch(url, opts);
  };

  // ---- popup UI ------------------------------------------------------------
  // Injected from here rather than written into popup.html + popup.js, so that
  // everything about the token lives in one file.

  if (typeof document === "undefined") return;

  document.addEventListener("DOMContentLoaded", function () {
    var host = document.querySelector(".footer");
    if (!host) return;

    var wrap = document.createElement("div");
    wrap.style.cssText =
      "margin-top:10px;padding-top:10px;border-top:1px solid #f3f4f6;font-size:11px;color:#6b7280;";

    var label = document.createElement("div");
    label.textContent = "Workspace token";
    label.style.cssText = "font-weight:600;color:#374151;margin-bottom:4px;";

    var hint = document.createElement("div");
    hint.style.cssText = "margin-bottom:6px;line-height:1.4;";
    hint.textContent = "Settings → This computer, on the dashboard. Decides which workspace this browser collects for.";

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;";

    var input = document.createElement("input");
    input.type = "password";
    input.placeholder = "gx_…";
    input.style.cssText =
      "flex:1;min-width:0;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;font-family:ui-monospace,monospace;";

    var save = document.createElement("button");
    save.textContent = "Save";
    save.style.cssText =
      "padding:6px 10px;border:none;border-radius:6px;background:#374151;color:#fff;font-size:11px;font-weight:600;cursor:pointer;";

    var note = document.createElement("div");
    note.style.cssText = "margin-top:5px;min-height:14px;";

    readToken().then(function (t) {
      if (t) {
        input.value = t;
        note.textContent = "✓ Set — collecting for the workspace this token belongs to.";
        note.style.color = "#059669";
      } else {
        note.textContent = "Not set — falling back to the original workspace.";
        note.style.color = "#b45309";
      }
    });

    save.addEventListener("click", function () {
      var value = input.value.trim();
      chrome.storage.local.set({ workspaceToken: value }, function () {
        cached = value;
        if (value) {
          note.textContent = "✓ Saved.";
          note.style.color = "#059669";
        } else {
          note.textContent = "Cleared — falling back to the original workspace.";
          note.style.color = "#b45309";
        }
      });
    });

    row.appendChild(input);
    row.appendChild(save);
    wrap.appendChild(label);
    wrap.appendChild(hint);
    wrap.appendChild(row);
    wrap.appendChild(note);
    host.parentNode.insertBefore(wrap, host);
  });
})();
