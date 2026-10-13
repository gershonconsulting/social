// Extension 0.20.0 — "really in the background". Runs the REAL extension files in a fake Chrome.
//   node tests/background-window.test.mjs
import fs from "node:fs";
import vm from "node:vm";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const src = (f) => fs.readFileSync("extension-src/" + f, "utf8");

// ── 1. gx-visible.js ─────────────────────────────────────────────────────
function page(href, session = {}) {
  class Document {}
  const store = { ...session };
  const ctx = {
    Document, document: new Document(),
    location: { href, get hash() { const i = this.href.indexOf("#"); return i < 0 ? "" : this.href.slice(i); } },
    history: { state: null, replaceState(s, t, u) { ctx.location.href = u; } },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    setTimeout, clearTimeout, performance,
    IntersectionObserver: function Native() {}, requestAnimationFrame: function native() {},
  };
  ctx.window = ctx;
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => "hidden" });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => true });
  vm.runInNewContext(src("gx-visible.js"), ctx);
  return { ctx, store };
}
console.log("1. visibility fix only in the extension's own tabs");
let p = page("https://www.linkedin.com/company/cytel/posts/#gx-bg");
ok(p.ctx.document.visibilityState === "visible" && p.ctx.document.hidden === false, "marked tab: page told it is visible");
ok(p.ctx.location.href === "https://www.linkedin.com/company/cytel/posts/", "marker removed from the address");
ok(p.store["gx-bg"] === "1" && p.ctx.__gxBackground === true, "remembered for the tab");
let io; await new Promise((r) => { const o = new p.ctx.IntersectionObserver((e) => { io = e; r(); }); o.observe({ getBoundingClientRect: () => ({}) }); });
ok(io && io[0].isIntersecting === true, "lazy-loading triggers fire");
let raf = await new Promise((r) => p.ctx.requestAnimationFrame((t) => r(t)));
ok(typeof raf === "number", "animation frames keep coming");
p = page("https://x.com/GershonCons", { "gx-bg": "1" });
ok(p.ctx.document.visibilityState === "visible", "next page in the same extension tab (no marker) still fixed");
p = page("https://www.linkedin.com/feed/");
ok(p.ctx.document.visibilityState === "hidden" && !p.ctx.__gxBackground && p.ctx.IntersectionObserver.name === "Native", "your own LinkedIn tab is left untouched");
p = page("https://x.com/home#foo&gx-bg");
ok(p.ctx.document.visibilityState === "visible" && p.ctx.location.href === "https://x.com/home#foo", "marker after an existing #hash also works and is removed");

// ── fake chrome for the service-worker files ─────────────────────────────
function fakeChrome() {
  const log = { created: [], updated: [], winUpdates: [], reloads: 0 };
  const store = {}; const alarmL = []; const alarms = {};
  let nextTab = 100;
  const chrome = {
    _log: log, _store: store,
    windows: {
      create: async (o) => { log.created.push(o); return { id: 7, tabs: [{ id: nextTab++, windowId: 7 }] }; },
      update: async (id, o) => { log.winUpdates.push({ id, o }); },
      get: async (id) => ({ id, state: log.restored ? "normal" : "minimized" }),
      remove: async () => {}, getLastFocused: async () => ({ id: 1 }),
    },
    tabs: {
      create: async (o) => { log.created.push({ tab: o }); return { id: nextTab++, windowId: o.windowId || 1 }; },
      update: async (id, o) => { log.updated.push({ id, o }); return { id }; },
      get: async (id) => ({ id, windowId: 7 }), query: async () => [], sendMessage() {},
    },
    storage: { local: {
      get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
      set: async (o) => { Object.assign(store, o); }, remove: async (k) => { delete store[k]; },
    }, onChanged: { addListener() {} } },
    alarms: { get: (n, cb) => { const a = alarms[n] || null; if (cb) cb(a); return Promise.resolve(a); }, create: (n, o) => { alarms[n] = o; }, clear: async () => {}, onAlarm: { addListener: (f) => alarmL.push(f) } },
    runtime: { getManifest: () => ({ version: "0.20.0" }), getPlatformInfo: (cb) => (cb ? cb({}) : Promise.resolve({})), onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener() {} }, getURL: (p) => "chrome-extension://x/" + p, reload: () => { log.reloads++; } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    scripting: { executeScript: async () => [{ result: null }] },
    cookies: { get: async () => null, onChanged: { addListener() {} } },
    notifications: { create() {}, onClicked: { addListener() {} } },
    tts: { speak() {} },
  };
  chrome._fire = async (n) => { for (const f of alarmL) await f({ name: n }); };
  return chrome;
}

// ── 2. gx-collect.js ─────────────────────────────────────────────────────
console.log("2. collection window: minimized, focus never touched");
{
  const chrome = fakeChrome();
  chrome._store.workspaceToken = "wt_x";
  const self = {};
  self.runFullSync = async () => {
    await chrome.tabs.create({ url: "https://www.linkedin.com/company/cytel/posts/" });
    await chrome.tabs.update(101, { url: "https://x.com/GershonCons" });
    await chrome.tabs.update(101, { url: "https://example.com/" });
    chrome._log.restored = true; await self.gxKeepMinimized(); chrome._log.restored = false;
    return { ok: true };
  };
  vm.runInNewContext(src("gx-collect.js"), { chrome, self, setTimeout, clearTimeout, setInterval, clearInterval, console, Promise, Date, Object, JSON, Math, String });
  const r = await self.runFullSync({});
  const win = chrome._log.created.find((c) => !c.tab);
  ok(r.ok && win && win.state === "minimized" && win.focused === false, "window created minimized and unfocused");
  ok(!("width" in win) && !("left" in win), "no on-screen position given");
  ok(chrome._log.winUpdates.every((u) => u.o.state === "minimized" && !u.o.focused), "no window was ever brought forward or focused");
  ok(chrome._log.winUpdates.length === 1, "a window restored mid-run is put back to minimized (" + chrome._log.winUpdates.length + " fix)");
  const tab = chrome._log.created.find((c) => c.tab).tab;
  ok(tab.url.endsWith("#gx-bg") && tab.windowId === 7, "LinkedIn tab opens in the collection window with the marker");
  const urls = chrome._log.updated.map((u) => u.o.url).filter(Boolean);
  ok(urls.includes("https://x.com/GershonCons#gx-bg"), "X page gets the marker");
  ok(urls.includes("https://example.com/"), "other sites left as they are");
  ok(self.gxMarkUrl("https://www.linkedin.com/a#b") === "https://www.linkedin.com/a#b&gx-bg", "existing #hash kept, marker appended");
}

// ── 3. gx-publish.js ─────────────────────────────────────────────────────
console.log("3. publishing: minimized first, visible retry after a failure before the click");
{
  const chrome = fakeChrome();
  chrome._store.workspaceToken = "wt_x";
  const posts = [{ id: "d1", platform: "LINKEDIN", target: "", text: "hello", media: [] }];
  const reports = [];
  const fetchFake = async (url, init) => {
    if (String(url).includes("/publish/due")) { const p = posts.shift(); return { ok: true, status: 200, json: async () => ({ success: true, data: { enabled: true, post: p || null } }) }; }
    if (String(url).includes("/publish/result")) { reports.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }), text: async () => "" };
  };
  const self = {};
  // LinkedIn reports signed in via cookie
  chrome.cookies.get = async (q) => ({ value: "x" });
  vm.runInNewContext(src("gx-publish.js"), { chrome, self, fetch: fetchFake, setTimeout: (f) => setTimeout(f, 0), clearTimeout, console, Promise, Date, Object, JSON, Math, String, encodeURIComponent, btoa, atob, Uint8Array, Array, RegExp, Error, Set });
  ok(typeof self.gxPublishing === "function" && self.gxPublishing() === false, "publishing busy flag exposed");
  // run one tick: delivery d1 has no LinkedIn page → failed_before_click
  await chrome._fire("publish-tick");
  await new Promise((r) => setTimeout(r, 50));
  const w1 = chrome._log.created.filter((c) => !c.tab);
  ok(w1.length >= 1 && w1[0].state === "minimized", "first attempt in a minimized window");
  ok(reports.some((r) => r.id === "d1" && r.outcome === "failed_before_click"), "failure before the click reported");
  ok(chrome._store.publishVisibleRetry && chrome._store.publishVisibleRetry.d1, "retry marked to use a visible window");
  posts.push({ id: "d1", platform: "LINKEDIN", target: "", text: "hello", media: [] });
  await chrome._fire("publish-tick");
  await new Promise((r) => setTimeout(r, 50));
  const w2 = chrome._log.created.filter((c) => !c.tab);
  ok(w2.length >= 2 && !w2[1].state && w2[1].width === 1280, "retry opens a normal window");
}

// ── 4. gx-update.js ──────────────────────────────────────────────────────
console.log("4. self-update");
async function upd(diskVersion, busyFlags = {}) {
  const chrome = fakeChrome();
  const self = { gxCollectRunning: () => !!busyFlags.collect, gxPublishing: () => !!busyFlags.publish, gxRemoteBusy: () => !!busyFlags.remote };
  const fetchFake = async () => (diskVersion === "broken" ? { json: async () => { throw new Error("bad json"); } } : { json: async () => ({ version: diskVersion }) });
  vm.runInNewContext(src("gx-update.js"), { chrome, self, fetch: fetchFake, console, Promise, Date, String, Number, Math });
  return { chrome, self };
}
{
  let { chrome, self } = await upd("0.20.0");
  await self.gxSelfUpdateCheck(); await self.gxSelfUpdateCheck();
  ok(chrome._log.reloads === 0, "same version on disk → no reload");
  ({ chrome, self } = await upd("0.21.0"));
  let r1 = await self.gxSelfUpdateCheck();
  ok(chrome._log.reloads === 0 && /first sighting/.test(r1.why), "newer files seen once → waits for the next check");
  await self.gxSelfUpdateCheck();
  ok(chrome._log.reloads === 1, "seen twice → reloads itself");
  ({ chrome, self } = await upd("0.21.0", { collect: true }));
  await self.gxSelfUpdateCheck(); const rb = await self.gxSelfUpdateCheck();
  ok(chrome._log.reloads === 0 && rb.why === "busy", "collection running → waits");
  ({ chrome, self } = await upd("0.21.0", { publish: true }));
  await self.gxSelfUpdateCheck(); await self.gxSelfUpdateCheck();
  ok(chrome._log.reloads === 0, "post going out → waits");
  ({ chrome, self } = await upd("broken"));
  await self.gxSelfUpdateCheck(); await self.gxSelfUpdateCheck();
  ok(chrome._log.reloads === 0, "half-copied / unreadable files → never reloads");
  ({ chrome, self } = await upd("0.19.9"));
  await self.gxSelfUpdateCheck(); await self.gxSelfUpdateCheck();
  ok(chrome._log.reloads === 0, "older files on disk → no reload");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
