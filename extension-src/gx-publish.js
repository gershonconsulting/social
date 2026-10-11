// Publishing — posts approved content on LinkedIn AND X from THIS browser.
// (extension 0.15.0; replaces HeroPost)
//
// The dashboard (social.gershoncrm.com/publishing) holds the content, the
// client review loop and the calendar. This file does the publishing:
//
//   1. KEEP THE CONNECTIONS LIVE.
//      - Reads the sign-in cookies of this browser's own cookie jar (li_at for
//        LinkedIn, auth_token for X). No request is sent to check them.
//      - Heartbeat to the dashboard every 5 minutes, and at once on any X
//        sign-in / sign-out: which networks are signed in, and as whom (X).
//      - X signs the browser out → speaks an alert ("Project: Social. Task: X
//        signed you out"), opens the X login page (1Password fills it), shows a
//        notification + red "X" badge, repeats every 10 min (6× max). LinkedIn
//        sign-outs are already handled the same way by gx-session-watch.js.
//      - On every X sign-in the fresh session goes to /api/cookies/save so the
//        collection keeps working.
//      It never types a password and never submits a login form.
//
//   2. PUBLISH. Every minute it asks /api/extension/publish/due for the next
//      delivery whose time has come — one at a time, claimed by the server, so
//      nothing goes out twice — and loops until none is left, so LinkedIn and
//      X go out back to back. For each delivery, in a separate unfocused window:
//        X:        x.com/intent/post?text=… → attach the pictures → check the text, pictures and Post button
//                  → click → find the post on the profile → report its URL.
//        LinkedIn: the company page admin (or the feed for a profile) → pictures →
//                  "Start a post" → paste the text → click Post → take the
//                  post's link from LinkedIn's "Post successful" toast, or find
//                  it on the page's posts → report it.
//      Anything that fails BEFORE the Post click is reported as such and the
//      server retries (3 tries). After the click it is never retried; if the
//      post is not visible yet it is "clicked_unconfirmed" and the daily
//      collection confirms it.
//
// Only runs once this install is bound to a workspace (gx-bridge.js).
// Loaded before gx-collect.js (gx-boot.js) so it uses the real tab APIs.

(function () {
  var API = "https://social.gershoncrm.com/api/extension/publish";
  var COOKIE_SAVE = "https://social.gershoncrm.com/api/cookies/save";
  var X_LOGIN_URL = "https://x.com/i/flow/login";
  var BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  var TICK_ALARM = "publish-tick";
  var NAG_ALARM = "x-watch-nag";
  var STATE_KEY = "publishState";
  var BEAT_EVERY_MS = 5 * 60 * 1000;
  var HANDLE_TTL_MS = 6 * 60 * 60 * 1000;
  var NAG_EVERY_MIN = 10;
  var NAG_MAX = 6;
  var SETTLE_MS = 15000;
  var MAX_PER_TICK = 6;
  var DEFAULT_VOICE = "I need you now. Project: Social. Task: X signed you out. Please sign back in so scheduled posts can go out.";

  var nativeTabCreate = chrome.tabs.create.bind(chrome.tabs);
  var nativeTabUpdate = chrome.tabs.update.bind(chrome.tabs);
  var publishing = false;
  var settleTimer = null;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function version() { try { return chrome.runtime.getManifest().version; } catch (e) { return null; } }

  async function getState() {
    try { var r = await chrome.storage.local.get(STATE_KEY); return (r && r[STATE_KEY]) || {}; } catch (e) { return {}; }
  }
  async function setState(patch) {
    var s = Object.assign(await getState(), patch);
    try { await chrome.storage.local.set({ [STATE_KEY]: s }); } catch (e) {}
    return s;
  }
  async function bound() {
    try { var r = await chrome.storage.local.get("workspaceToken"); return !!(r && r.workspaceToken); } catch (e) { return false; }
  }

  // ── Sessions ────────────────────────────────────────────────────────────
  async function cookie(urls, name) {
    for (var i = 0; i < urls.length; i++) {
      try {
        var c = await chrome.cookies.get({ url: urls[i], name: name });
        if (c && c.value) return c.value;
      } catch (e) {}
    }
    return null;
  }
  function xCookie(name) { return cookie(["https://x.com/", "https://twitter.com/"], name); }
  async function xSignedIn() { return !!(await xCookie("auth_token")); }
  async function liSignedIn() { return !!(await cookie(["https://www.linkedin.com/", "https://linkedin.com/"], "li_at")); }

  /** The @handle X says this browser is signed in as. Cached 6 h. */
  async function xWhoAmI(force) {
    var s = await getState();
    if (!force && s.xHandle && s.xHandleAt && Date.now() - s.xHandleAt < HANDLE_TTL_MS) return s.xHandle;
    var ct0 = await xCookie("ct0");
    if (!ct0) return s.xHandle || null;
    try {
      var r = await fetch("https://x.com/i/api/1.1/account/settings.json", {
        credentials: "include",
        headers: { authorization: "Bearer " + BEARER, "x-csrf-token": ct0, "x-twitter-auth-type": "OAuth2Session", "x-twitter-active-user": "yes" }
      });
      if (r.ok) {
        var j = await r.json();
        if (j && j.screen_name) { await setState({ xHandle: j.screen_name, xHandleAt: Date.now() }); return j.screen_name; }
      }
    } catch (e) {}
    return s.xHandle || null;
  }

  async function saveXSession() {
    var names = ["auth_token", "ct0", "twid", "kdt"];
    var cookies = {};
    for (var i = 0; i < names.length; i++) { var v = await xCookie(names[i]); if (v) cookies[names[i]] = v; }
    if (!cookies.auth_token) return;
    try {
      await fetch(COOKIE_SAVE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "TWITTER", cookies: cookies, capturedAt: new Date().toISOString() })
      });
    } catch (e) {}
  }

  async function heartbeat(extra) {
    if (!(await bound())) return null;
    var xIn = await xSignedIn();
    var liIn = await liSignedIn();
    var xAs = xIn ? await xWhoAmI(false) : null;
    try {
      var r = await fetch(API + "/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ x: { signedIn: xIn, as: xAs }, linkedin: { signedIn: liIn }, version: version() }, extra || {}))
      });
      var j = await r.json().catch(function () { return null; });
      var patch = { beatAt: Date.now() };
      if (j && j.success && j.data) {
        patch.voiceX = (j.data.voice && j.data.voice.x) || null;
        patch.enabled = j.data.enabled !== false;
      }
      await setState(patch);
      return j && j.data;
    } catch (e) { return null; }
  }

  // ── X sign-out alerting (LinkedIn's lives in gx-session-watch.js) ───────
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
    var opts = { rate: 0.95, enqueue: true };
    if (name) opts.voiceName = name;
    try { chrome.tts.speak(text, opts); } catch (e) {}
  }
  function badgeOut() {
    try {
      chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
      chrome.action.setBadgeText({ text: "X" });
      chrome.action.setTitle({ title: "X signed you out — scheduled X posts are on hold" });
    } catch (e) {}
  }
  function badgeClear() {
    try { chrome.action.getBadgeText({}, function (t) { if (t === "X") chrome.action.setBadgeText({ text: "" }); }); } catch (e) {}
  }
  async function openXLogin() {
    var s = await getState();
    if (s.loginTabId != null) {
      try {
        var t = await chrome.tabs.get(s.loginTabId);
        if (t && /(x|twitter)\.com/.test(t.url || t.pendingUrl || "")) {
          await nativeTabUpdate(t.id, { active: true });
          await chrome.windows.update(t.windowId, { focused: true });
          return;
        }
      } catch (e) {}
    }
    var props = { url: X_LOGIN_URL, active: true };
    try {
      var w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      var collect = (await chrome.storage.local.get("collectWindowId")).collectWindowId;
      if (w && w.id !== collect && w.id !== s.publishWindowId) props.windowId = w.id;
    } catch (e) {}
    try {
      var tab = await nativeTabCreate(props);
      await setState({ loginTabId: tab.id });
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
    } catch (e) {}
  }
  function notifyOut() {
    try {
      chrome.notifications.create("x-watch", {
        type: "basic", iconUrl: "icons/icon128.png", title: "X signed you out",
        message: "Scheduled X posts are on hold. The X login page is open — sign back in.",
        priority: 2, requireInteraction: true
      });
    } catch (e) {}
  }

  async function onXSignedOut() {
    var s = await getState();
    if (s.xWatch === "out") return;
    await setState({ xWatch: "out", nags: 1, loginTabId: null, xHandle: null, xHandleAt: 0 });
    badgeOut();
    await heartbeat();
    s = await getState();
    await speak(s.voiceX || DEFAULT_VOICE);
    await openXLogin();
    notifyOut();
    try { chrome.alarms.create(NAG_ALARM, { delayInMinutes: NAG_EVERY_MIN, periodInMinutes: NAG_EVERY_MIN }); } catch (e) {}
  }
  async function onXSignedIn() {
    var s = await getState();
    var wasOut = s.xWatch === "out";
    if (s.xWatch === "in" && s.xSessionSaved) return;
    await setState({ xWatch: "in", nags: 0, loginTabId: null, xHandleAt: 0, xSessionSaved: true });
    try { await chrome.alarms.clear(NAG_ALARM); } catch (e) {}
    try { chrome.notifications.clear("x-watch"); } catch (e) {}
    badgeClear();
    await xWhoAmI(true);
    await saveXSession();
    if (wasOut || !s.beatAt) await heartbeat();
  }
  async function checkX() {
    if (!(await bound())) return;
    if (await xSignedIn()) await onXSignedIn();
    else await onXSignedOut();
  }

  // ── Page helpers ────────────────────────────────────────────────────────
  function norm(t) {
    return String(t || "").replace(/https?:\/\/\S+/gi, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
  }
  async function report(id, outcome, postUrl, error) {
    try {
      await fetch(API + "/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: id, outcome: outcome, postUrl: postUrl || null, error: error || null })
      });
    } catch (e) {}
  }
  async function run(tabId, func, args) {
    try {
      var r = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: func, args: args || [] });
      return r && r[0] ? r[0].result : null;
    } catch (e) { return null; }
  }
  async function navigate(tabId, url) { await nativeTabUpdate(tabId, { url: url }); await sleep(3500); }
  async function openWindow(url) {
    var w = await chrome.windows.create({ url: url, focused: false, type: "normal", width: 1280, height: 900, top: 0, left: 0 });
    await setState({ publishWindowId: w.id });
    return { winId: w.id, tabId: w.tabs && w.tabs[0] && w.tabs[0].id };
  }

  // ── Pictures (0.15.0) ───────────────────────────────────────────────────
  // The dashboard hands each delivery its pictures as URLs. They are fetched
  // here, then handed to the network's own file input inside the page, so the
  // network uploads them exactly as if they had been picked by hand.
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function fetchMedia(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var m = list[i];
      var r = await fetch(m.url, { cache: "no-store" });
      if (!r.ok) throw new Error("Could not download picture " + (i + 1) + " (HTTP " + r.status + ").");
      out.push({ b64: bufToB64(await r.arrayBuffer()), mime: m.mime || "image/jpeg", name: m.name || "picture-" + (i + 1) + ".jpg" });
    }
    return out;
  }
  // Runs in the page: give the files to the first matching file input.
  function attachFiles(files, selectors) {
    var input = null;
    for (var i = 0; i < selectors.length && !input; i++) input = document.querySelector(selectors[i]);
    if (!input) return { ok: false, why: "no file input" };
    var dt = new DataTransfer();
    files.forEach(function (f) {
      var bin = atob(f.b64);
      var arr = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
      dt.items.add(new File([arr], f.name, { type: f.mime }));
    });
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, count: dt.files.length };
  }
  // Runs in the page: how many large pictures sit in the composer.
  function countComposerPictures(scopeSel) {
    var scope = (scopeSel && document.querySelector(scopeSel)) || document;
    var imgs = Array.from(scope.querySelectorAll("img, video"));
    return imgs.filter(function (im) {
      var r = im.getBoundingClientRect();
      var src = im.getAttribute("src") || "";
      return r.width >= 90 && r.height >= 60 && !/profile|avatar|emoji/i.test(src + " " + (im.className || ""));
    }).length;
  }

  // ── X ───────────────────────────────────────────────────────────────────
  function xReadComposer() {
    var url = location.href;
    if (/\/login|\/i\/flow\/login|\/logout/.test(url)) return { login: true, url: url };
    var box = document.querySelector('[data-testid="tweetTextarea_0"]');
    var btn = document.querySelector('[data-testid="tweetButton"]') || document.querySelector('[data-testid="tweetButtonInline"]');
    var toast = document.querySelector('[data-testid="toast"]');
    return { url: url, text: box ? box.innerText : null, hasButton: !!btn,
      enabled: !!btn && btn.getAttribute("aria-disabled") !== "true" && !btn.disabled, toast: toast ? toast.innerText : null };
  }
  function xClickPost() {
    var btn = document.querySelector('[data-testid="tweetButton"]') || document.querySelector('[data-testid="tweetButtonInline"]');
    if (!btn || btn.getAttribute("aria-disabled") === "true") return false;
    btn.click();
    return true;
  }
  function xReadProfile() {
    var out = [];
    var arts = document.querySelectorAll('article[data-testid="tweet"]');
    for (var i = 0; i < arts.length && out.length < 10; i++) {
      var t = arts[i].querySelector('[data-testid="tweetText"]');
      var time = arts[i].querySelector("time");
      var link = time && time.closest("a");
      out.push({ text: t ? t.innerText : "", href: link ? link.getAttribute("href") : null });
    }
    return out;
  }

  async function publishX(d, w) {
    var clicked = false;
    if (!(await xSignedIn())) { await report(d.id, "failed_before_click", null, "X is signed out in the publishing browser."); await onXSignedOut(); return; }
    var me = await xWhoAmI(false);
    if (me && d.target && me.toLowerCase() !== String(d.target).toLowerCase()) {
      await report(d.id, "failed_before_click", null, "This browser is signed in to X as @" + me + ", the post is for @" + d.target + ".");
      return;
    }
    await navigate(w.tabId, "https://x.com/intent/post?text=" + encodeURIComponent(d.text));
    var want = norm(d.text).slice(0, 40);
    var st = null;
    for (var i = 0; i < 30; i++) {
      st = await run(w.tabId, xReadComposer);
      if (st && st.login) break;
      if (st && st.hasButton && st.enabled && norm(st.text).indexOf(want.slice(0, 25)) === 0) break;
      await sleep(1000);
    }
    if (!st || st.login) { await report(d.id, "failed_before_click", null, "X asked to sign in again."); await onXSignedOut(); return; }
    if (!st.hasButton) { await report(d.id, "failed_before_click", null, "The X composer did not load."); return; }
    if (norm(st.text).indexOf(want.slice(0, 25)) !== 0) { await report(d.id, "failed_before_click", null, "The X composer did not receive the text."); return; }
    if (!st.enabled) { await report(d.id, "failed_before_click", null, "X disabled the Post button (too long for this account, or the text was refused)."); return; }

    if (d.media && d.media.length) {
      var files;
      try { files = await fetchMedia(d.media); } catch (e) { await report(d.id, "failed_before_click", null, e.message); return; }
      var at = await run(w.tabId, attachFiles, [files, ['input[data-testid="fileInput"]', 'input[type="file"][accept*="image"]']]);
      if (!at || !at.ok) { await report(d.id, "failed_before_click", null, "Could not attach the pictures on X."); return; }
      // X disables Post while it uploads; wait for every picture and the button.
      var ready = false;
      for (var u = 0; u < 60 && !ready; u++) {
        await sleep(1000);
        var n = await run(w.tabId, countComposerPictures, ['[data-testid="attachments"]']);
        var c2 = await run(w.tabId, xReadComposer);
        if (n >= files.length && c2 && c2.enabled) ready = true;
      }
      if (!ready) { await report(d.id, "failed_before_click", null, "X did not finish taking the pictures."); return; }
      st = await run(w.tabId, xReadComposer);
    }

    var preUrl = st.url;
    clicked = !!(await run(w.tabId, xClickPost));
    w.clicked = clicked;
    if (!clicked) { await report(d.id, "failed_before_click", null, "Could not press Post on X."); return; }

    var accepted = false, errToast = null;
    for (var k = 0; k < 15; k++) {
      await sleep(1000);
      var after = await run(w.tabId, xReadComposer);
      if (!after) { accepted = true; break; }
      if (after.toast && /(went wrong|already said|whoops|limit|try again|not sent)/i.test(after.toast)) errToast = after.toast;
      if (!after.hasButton || after.url !== preUrl) { accepted = true; break; }
    }
    if (!accepted && errToast) { await report(d.id, "failed_before_click", null, "X refused the post: " + errToast.slice(0, 200)); return; }

    var handle = d.target || me;
    var found = null;
    for (var pass = 0; pass < 2 && !found && handle; pass++) {
      await navigate(w.tabId, "https://x.com/" + handle);
      for (var p = 0; p < 10 && !found; p++) {
        await sleep(1500);
        var posts = (await run(w.tabId, xReadProfile)) || [];
        for (var q = 0; q < posts.length; q++) {
          var n = norm(posts[q].text);
          if (posts[q].href && want.length >= 5 && (n.indexOf(want.slice(0, 30)) === 0 || want.indexOf(n.slice(0, 30)) === 0)) {
            found = "https://x.com" + posts[q].href.replace(/\/analytics$/, "");
            break;
          }
        }
      }
      if (!found) await sleep(8000);
    }
    await report(d.id, found ? "posted" : "clicked_unconfirmed", found, null);
  }

  // ── LinkedIn ────────────────────────────────────────────────────────────
  function liTarget(url) {
    var m = String(url || "").match(/linkedin\.com\/(company|showcase|in)\/([^/?#]+)/i);
    return m ? { kind: m[1].toLowerCase(), slug: m[2] } : null;
  }

  // Runs in the LinkedIn page: open the share box. Returns what it found.
  function liOpenComposer() {
    if (/\/login|\/checkpoint|\/authwall|\/uas\//.test(location.href)) return { login: true };
    var dlg = document.querySelector('[role="dialog"] .ql-editor[contenteditable="true"], .share-creation-state .ql-editor');
    if (dlg) return { open: true };
    var all = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'));
    var start = all.find(function (b) { return /^\s*(start a post|create a post|write a post)/i.test(b.innerText || b.getAttribute("aria-label") || ""); });
    if (start) { start.click(); return { clicked: "start" }; }
    var create = all.find(function (b) { return /^\s*create\s*$/i.test(b.innerText || ""); });
    if (create) { create.click(); return { clicked: "create" }; }
    return { none: true, url: location.href };
  }
  // Runs in the LinkedIn page: put the text in the editor.
  function liFill(text) {
    var ed = document.querySelector('[role="dialog"] .ql-editor[contenteditable="true"]') || document.querySelector(".share-creation-state .ql-editor");
    if (!ed) return { ok: false, why: "no editor" };
    ed.focus();
    try {
      var dt = new DataTransfer();
      dt.setData("text/plain", text);
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) {}
    if (!(ed.innerText || "").trim()) {
      try { document.execCommand("insertText", false, text); } catch (e) {}
    }
    return { ok: true, text: ed.innerText || "" };
  }
  // Runs in the LinkedIn page: open the picture picker inside the post box.
  function liOpenMediaPicker() {
    var dlg = document.querySelector('[role="dialog"]') || document;
    var b = Array.from(dlg.querySelectorAll("button")).find(function (x) {
      return /add (a )?(photo|media|picture|image)/i.test((x.getAttribute("aria-label") || "") + " " + (x.innerText || ""));
    });
    if (b) { b.click(); return true; }
    return false;
  }
  // Runs in the LinkedIn page: move through the picture editor back to the post box.
  function liMediaEditorStep() {
    var dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { composer: false, pictures: 0 };
    var editor = document.querySelector('[role="dialog"] .ql-editor[contenteditable="true"]');
    if (editor) {
      var imgs = Array.from(dlg.querySelectorAll("img, video")).filter(function (im) {
        var r = im.getBoundingClientRect();
        return r.width >= 90 && r.height >= 60;
      });
      return { composer: true, pictures: imgs.length };
    }
    var next = Array.from(dlg.querySelectorAll("button")).find(function (x) {
      return /^\s*(next|done)\s*$/i.test(x.innerText || "") && !x.disabled;
    });
    if (next) next.click();
    return { composer: false, pictures: 0, clicked: !!next };
  }
  function liPostButton() {
    var dlg = document.querySelector('[role="dialog"]') || document;
    var b = dlg.querySelector("button.share-actions__primary-action") ||
      Array.from(dlg.querySelectorAll("button")).find(function (x) { return /^\s*post\s*$/i.test(x.innerText || ""); });
    return b || null;
  }
  function liReadComposer() {
    var dlg = document.querySelector('[role="dialog"]');
    var ed = document.querySelector('[role="dialog"] .ql-editor[contenteditable="true"]') || document.querySelector(".share-creation-state .ql-editor");
    var dlgEl = document.querySelector('[role="dialog"]') || document;
    var b = dlgEl.querySelector("button.share-actions__primary-action") ||
      Array.from(dlgEl.querySelectorAll("button")).find(function (x) { return /^\s*post\s*$/i.test(x.innerText || ""); });
    var toastLink = document.querySelector('.artdeco-toast-item a[href*="/feed/update/"], .artdeco-toasts_toasts a[href*="/feed/update/"]');
    var toast = document.querySelector(".artdeco-toast-item");
    return {
      dialog: !!dlg, text: ed ? ed.innerText : null, hasButton: !!b,
      enabled: !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true",
      toast: toast ? toast.innerText : null, toastHref: toastLink ? toastLink.getAttribute("href") : null
    };
  }
  function liClickPost() {
    var dlgEl = document.querySelector('[role="dialog"]') || document;
    var b = dlgEl.querySelector("button.share-actions__primary-action") ||
      Array.from(dlgEl.querySelectorAll("button")).find(function (x) { return /^\s*post\s*$/i.test(x.innerText || ""); });
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }
  function liReadPosts() {
    var out = [];
    var nodes = document.querySelectorAll('[data-urn^="urn:li:activity:"], [data-id^="urn:li:activity:"]');
    for (var i = 0; i < nodes.length && out.length < 10; i++) {
      var n = nodes[i];
      var urn = n.getAttribute("data-urn") || n.getAttribute("data-id");
      var t = n.querySelector(".update-components-text, .feed-shared-update-v2__description, .feed-shared-text");
      out.push({ urn: urn, text: t ? t.innerText : "" });
    }
    return out;
  }

  async function publishLinkedIn(d, w) {
    var clicked = false;
    if (!(await liSignedIn())) { await report(d.id, "failed_before_click", null, "LinkedIn is signed out in the publishing browser."); return; }
    var t = liTarget(d.target);
    if (!t) { await report(d.id, "failed_before_click", null, "No LinkedIn page set for this client."); return; }
    var home = t.kind === "in" ? "https://www.linkedin.com/feed/" : "https://www.linkedin.com/" + t.kind + "/" + t.slug + "/admin/page-posts/published/";
    await navigate(w.tabId, home);

    var opened = false;
    for (var i = 0; i < 20 && !opened; i++) {
      var o = await run(w.tabId, liOpenComposer);
      if (o && o.login) { await report(d.id, "failed_before_click", null, "LinkedIn asked to sign in again."); return; }
      if (o && o.open) opened = true;
      else await sleep(1500);
    }
    if (!opened) {
      await report(d.id, "failed_before_click", null,
        t.kind === "in" ? "Could not open the LinkedIn post box." : "Could not open the post box for this LinkedIn page — is this LinkedIn account an admin of the page?");
      return;
    }

    if (d.media && d.media.length) {
      var lfiles;
      try { lfiles = await fetchMedia(d.media); } catch (e) { await report(d.id, "failed_before_click", null, e.message); return; }
      await run(w.tabId, liOpenMediaPicker);
      await sleep(1500);
      var la = await run(w.tabId, attachFiles, [lfiles, ['[role="dialog"] input[type="file"]', 'input[type="file"][accept*="image"]', 'input[type="file"]']]);
      if (!la || !la.ok) { await report(d.id, "failed_before_click", null, "Could not attach the pictures on LinkedIn."); return; }
      // LinkedIn shows its picture editor; "Next" / "Done" brings the post box back.
      var back = false;
      for (var e2 = 0; e2 < 40 && !back; e2++) {
        await sleep(1000);
        var stp = await run(w.tabId, liMediaEditorStep);
        if (stp && stp.composer && stp.pictures >= 1) back = true;
      }
      if (!back) { await report(d.id, "failed_before_click", null, "LinkedIn did not take the pictures."); return; }
    }

    var want = norm(d.text).slice(0, 40);
    var filled = null;
    for (var f = 0; f < 3; f++) {
      filled = await run(w.tabId, liFill, [d.text]);
      await sleep(1500);
      var c = await run(w.tabId, liReadComposer);
      if (c && norm(c.text).indexOf(want.slice(0, 25)) === 0) { filled = c; break; }
      filled = null;
    }
    if (!filled) { await report(d.id, "failed_before_click", null, "The LinkedIn post box did not receive the text."); return; }
    if (!filled.hasButton || !filled.enabled) { await report(d.id, "failed_before_click", null, "LinkedIn's Post button is not available."); return; }
    if (d.media && d.media.length) {
      var still = await run(w.tabId, countComposerPictures, ['[role="dialog"]']);
      if (!still) { await report(d.id, "failed_before_click", null, "The pictures disappeared from the LinkedIn post box."); return; }
    }

    clicked = !!(await run(w.tabId, liClickPost));
    w.clicked = clicked;
    if (!clicked) { await report(d.id, "failed_before_click", null, "Could not press Post on LinkedIn."); return; }

    var found = null, closed = false, errToast = null;
    for (var k = 0; k < 20 && !found; k++) {
      await sleep(1000);
      var a = await run(w.tabId, liReadComposer);
      if (!a) continue;
      if (a.toastHref) found = a.toastHref.indexOf("http") === 0 ? a.toastHref : "https://www.linkedin.com" + a.toastHref;
      if (!a.dialog) closed = true;
      if (a.toast && /(something went wrong|couldn.t|try again|failed)/i.test(a.toast)) errToast = a.toast;
      if (closed && k > 6 && !found) break;
    }
    if (!found && !closed && errToast) { await report(d.id, "failed_before_click", null, "LinkedIn refused the post: " + errToast.slice(0, 200)); return; }

    if (!found) {
      var feed = t.kind === "in"
        ? "https://www.linkedin.com/in/" + t.slug + "/recent-activity/all/"
        : "https://www.linkedin.com/" + t.kind + "/" + t.slug + "/posts/?feedView=all";
      for (var pass = 0; pass < 2 && !found; pass++) {
        await navigate(w.tabId, feed);
        for (var p = 0; p < 8 && !found; p++) {
          await sleep(1500);
          var posts = (await run(w.tabId, liReadPosts)) || [];
          for (var q = 0; q < posts.length; q++) {
            var n = norm(posts[q].text);
            if (posts[q].urn && want.length >= 5 && (n.indexOf(want.slice(0, 30)) === 0 || want.indexOf(n.slice(0, 30)) === 0)) {
              found = "https://www.linkedin.com/feed/update/" + posts[q].urn + "/";
              break;
            }
          }
        }
        if (!found) await sleep(8000);
      }
    }
    await report(d.id, found ? "posted" : "clicked_unconfirmed", found, null);
  }

  // ── Loop ────────────────────────────────────────────────────────────────
  async function publishOne(d) {
    var w = null;
    try {
      w = await openWindow("about:blank");
      if (!w.tabId) throw new Error("Could not open a window.");
      if (d.platform === "TWITTER") await publishX(d, w);
      else if (d.platform === "LINKEDIN") await publishLinkedIn(d, w);
      else await report(d.id, "failed_before_click", null, "Unknown network " + d.platform);
      await setState({ lastPostAt: Date.now() });
    } catch (e) {
      // After the click: never re-post, the collection confirms it. Before: retry.
      await report(d.id, w && w.clicked ? "clicked_unconfirmed" : "failed_before_click", null, "Extension error: " + ((e && e.message) || String(e)));
    } finally {
      if (w && w.winId) { try { await chrome.windows.remove(w.winId); } catch (e) {} }
      await setState({ publishWindowId: null });
    }
  }

  async function tick() {
    if (!(await bound())) return;
    var s = await getState();
    if (!s.beatAt || Date.now() - s.beatAt > BEAT_EVERY_MS) await heartbeat();
    if (publishing) return;
    s = await getState();
    if (s.enabled === false) return;
    var skip = [];
    if (!(await xSignedIn())) skip.push("TWITTER");
    if (!(await liSignedIn())) skip.push("LINKEDIN");
    if (skip.length === 2) return;
    publishing = true;
    try {
      for (var i = 0; i < MAX_PER_TICK; i++) {
        var r = await fetch(API + "/due?skip=" + skip.join(","), { cache: "no-store" });
        var j = await r.json().catch(function () { return null; });
        var d = j && j.success && j.data && j.data.post;
        if (!d) break;
        await publishOne(d);
      }
    } catch (e) {
    } finally {
      publishing = false;
    }
  }

  // ── Wiring (top level, so the service worker re-registers on wake) ──────
  chrome.cookies.onChanged.addListener(function (info) {
    var c = info && info.cookie;
    if (!c) return;
    var dom = (c.domain || "").replace(/^\./, "");
    if (c.name === "li_at" && /linkedin\.com$/i.test(dom)) {
      // LinkedIn's alerting is gx-session-watch.js; just tell the dashboard.
      setTimeout(function () { heartbeat(); }, info.removed ? SETTLE_MS + 2000 : 2000);
      return;
    }
    if (c.name !== "auth_token" || !/(^|\.)(x|twitter)\.com$/i.test(dom)) return;
    if (!info.removed) { checkX(); return; }
    if (info.cause === "overwrite" || info.cause === "expired_overwrite") return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { settleTimer = null; checkX(); }, SETTLE_MS);
  });

  chrome.alarms.onAlarm.addListener(async function (alarm) {
    if (alarm.name === TICK_ALARM) { tick(); return; }
    if (alarm.name !== NAG_ALARM) return;
    if (await xSignedIn()) { await onXSignedIn(); return; }
    var s = await getState();
    if ((s.nags || 0) >= NAG_MAX) { try { await chrome.alarms.clear(NAG_ALARM); } catch (e) {} return; }
    await setState({ nags: (s.nags || 0) + 1 });
    badgeOut();
    await speak(s.voiceX || DEFAULT_VOICE);
    await openXLogin();
  });

  try { chrome.notifications.onClicked.addListener(function (id) { if (id === "x-watch") openXLogin(); }); } catch (e) {}

  function ensureTick() {
    try {
      chrome.alarms.get(TICK_ALARM, function (a) {
        if (!a) chrome.alarms.create(TICK_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
      });
    } catch (e) {}
  }
  chrome.runtime.onInstalled.addListener(function () { ensureTick(); checkX(); });
  chrome.runtime.onStartup.addListener(function () { ensureTick(); checkX(); });
  ensureTick();

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "publish-status") {
      Promise.all([getState(), xSignedIn(), liSignedIn()]).then(function (r) {
        sendResponse({ ok: true, state: r[0], x: r[1], linkedin: r[2], publishing: publishing });
      });
      return true;
    }
    if (msg && msg.type === "publish-tick") { tick().then(function () { sendResponse({ ok: true }); }); return true; }
    if (msg && msg.type === "x-watch-test") {
      getState().then(function (s) { return speak(s.voiceX || DEFAULT_VOICE); }).then(function () { sendResponse({ ok: true }); });
      return true;
    }
  });

  self.socialPublish = { tick: tick, checkX: checkX, heartbeat: heartbeat };
})();
