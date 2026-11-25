// Extension 0.28.0 — a collection tab closed mid-run is reopened, the run goes on.
//   node tests/tab-reopen.test.mjs
import fs from "node:fs";
import vm from "node:vm";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const code = fs.readFileSync("extension-src/sync-core.js", "utf8")
  .replace("const POST_NAV_SETTLE_MS = 5500;", "const POST_NAV_SETTLE_MS = 0;")
  .replace("const NAV_TIMEOUT_MS = 25000;", "const NAV_TIMEOUT_MS = 5;");
const alive = new Set([1]);
let nextId = 2, created = 0;
const chrome = {
  tabs: {
    update: async (id, p) => { if (!alive.has(id)) throw new Error("No tab with id: " + id + "."); return { id }; },
    create: async () => { created++; const id = nextId++; alive.add(id); return { id }; },
    get: async (id) => { if (!alive.has(id)) throw new Error("No tab with id: " + id + "."); return { id, url: "https://www.linkedin.com/company/x/posts/" }; },
    onUpdated: { addListener() {}, removeListener() {} },
    remove: async (id) => { alive.delete(id); },
  },
  scripting: { executeScript: async ({ target }) => { if (!alive.has(target.tabId)) throw new Error("No tab with id: " + target.tabId); return [{ result: { posts: [{ externalPostId: "a" }] } }]; } },
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { getManifest: () => ({ version: "0.28.0" }) },
};
const ctx = { chrome, console, setTimeout, clearTimeout, fetch: async () => ({ ok: false }), Date, Promise, encodeURIComponent };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(code + "\n;self.__scrapeKeepingTab = scrapeKeepingTab;", ctx);
const holder = { tabId: 1, ok: true };
const log = [];
alive.delete(1); // the tab is closed under the collector
const r1 = await ctx.__scrapeKeepingTab(holder, "https://www.linkedin.com/company/a/posts/", function () {}, log, "LINKEDIN:a", 1);
ok(!r1.error && r1.posts.length === 1, "company after the closed tab is still collected");
ok(holder.tabId === 2 && created === 1, "a fresh tab replaced the closed one");
ok(log.some((e) => e.step === "LINKEDIN:a:tab-reopened"), "the reopen is written to the run log");
const r2 = await ctx.__scrapeKeepingTab(holder, "https://www.linkedin.com/company/b/posts/", function () {}, log, "LINKEDIN:b", 1);
ok(!r2.error && created === 1, "next company reuses the new tab (no extra tab)");
ok(ctx.gxTabGone("executeScript: Frame with ID 0 was removed.") && !ctx.gxTabGone("posts are on the page but none could be read (LinkedIn layout changed again)"), "only browser-side errors trigger a reopen");
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
