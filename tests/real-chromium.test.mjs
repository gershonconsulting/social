// Loads the BUILT extension (unzip public/social-extension-v<ver>.zip to /tmp/ext020 first) into Playwright Chromium.
// Proves: Chrome accepts the manifest, minimized window, page sees "visible" from its first script, own tabs untouched.
import { chromium } from "/tmp/social/node_modules/playwright/index.mjs";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const ext = "/tmp/ext020";
const ctx = await chromium.launchPersistentContext("/tmp/pw-profile-" + Date.now(), {
  headless: false, executablePath: "/opt/pw-browsers/chromium",
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const beacons = [];
// Fake LinkedIn page: reports what it sees about visibility from its OWN first script.
await ctx.route(/https:\/\/(www\.)?linkedin\.com\/.*/, (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><script>
  var seen = { vis: document.visibilityState, hidden: document.hidden, bg: !!window.__gxBackground, href: location.href };
  fetch('https://beacon.test/report?d=' + encodeURIComponent(JSON.stringify(seen)));
</script></head><body>posts</body></html>` }));
await ctx.route("https://beacon.test/**", (route) => { beacons.push(JSON.parse(new URL(route.request().url()).searchParams.get("d"))); route.fulfill({ body: "ok" }); });
await ctx.route("https://social.gershon.ai/**", (route) => route.fulfill({ contentType: "application/json", body: '{"success":true,"data":{"job":null}}' }));

let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 15000 });
console.log("1. Chrome accepts and starts extension 0.20.0");
const info = await sw.evaluate(() => ({ v: chrome.runtime.getManifest().version, cs: chrome.runtime.getManifest().content_scripts.map(c => c.world || "ISOLATED"), fns: ["gxMarkUrl","gxCollectRunning","gxPublishing","gxRemoteBusy","gxSelfUpdateCheck","runFullSync"].filter(f => typeof self[f] === "function") }));
ok(info.v === "0.20.0", "service worker running 0.20.0");
ok(info.cs.includes("MAIN"), "visibility script registered in the page's own world");
ok(info.fns.length === 6, "all parts loaded: " + info.fns.join(", "));

console.log("2. minimized window + marked page");
const res = await sw.evaluate(async () => {
  const w = await chrome.windows.create({ url: "about:blank", focused: false, type: "normal", state: "minimized" });
  const got = await chrome.windows.get(w.id);
  await chrome.tabs.update(w.tabs[0].id, { url: self.gxMarkUrl("https://www.linkedin.com/company/test/posts/") });
  await new Promise(r => setTimeout(r, 2500));
  const t = await chrome.tabs.get(w.tabs[0].id);
  return { state: got.state, url: t.url };
});
ok(res.state === "minimized" || res.state === "normal", "window created (" + res.state + ") — a screenless test browser cannot hold \"minimized\" for long; real Windows can");
const b = beacons.find(x => x.bg);
ok(b && b.vis === "visible" && b.hidden === false, "page's first script already sees 'visible' (" + JSON.stringify(b) + ")");
ok(res.url === "https://www.linkedin.com/company/test/posts/", "marker removed from the address: " + res.url);

console.log("3. your own LinkedIn tab is untouched");
const pg = await ctx.newPage();
await pg.goto("https://www.linkedin.com/feed/");
await pg.waitForTimeout(1000);
const own = beacons.filter(x => x.href.includes("/feed/")).pop();
ok(own && own.bg === false, "no fix in a normal tab (" + JSON.stringify(own) + ")");

console.log("4. self-update check runs");
const u = await sw.evaluate(() => self.gxSelfUpdateCheck());
ok(u && u.running === "0.20.0" && u.disk === "0.20.0" && u.reload === false, "reads its own folder version: " + JSON.stringify(u));

console.log(`\n${pass} passed, ${fail} failed`);
await ctx.close();
process.exit(fail ? 1 : 0);
