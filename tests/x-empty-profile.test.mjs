// Extension 0.28.1 — an X profile with no tweet cards says WHY (never posted,
// renamed/deleted, suspended, protected, signed out) instead of always
// "no tweet cards found (selectors may have changed)".
//   node tests/x-empty-profile.test.mjs
import fs from "node:fs";
import vm from "node:vm";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const code = fs.readFileSync("extension-src/sync-core.js", "utf8");

// X's sidebar comes first in the page text, so the reason sits far past 400 characters.
const SIDEBAR = "Home\nExplore\nNotifications\nMessages\nGrok\nBookmarks\nJobs\nCommunities\nPremium\nVerified Orgs\nProfile\nMore\nPost\n" + "x".repeat(500) + "\n";

function run({ url = "https://x.com/somehandle", text = "", empty = "", loggedIn = true, button = null, cardsAfterClick = 0 }) {
  let clicked = false;
  const card = () => ({ querySelector: () => null });
  const document = {
    body: { innerText: SIDEBAR + text },
    querySelector(sel) {
      if (sel.includes("primaryColumn")) return { innerText: text };
      if (sel.includes("emptyState")) return empty ? { innerText: empty } : null;
      if (sel.includes("SideNav_AccountSwitcher_Button")) return loggedIn ? {} : null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes("article")) return clicked ? Array.from({ length: cardsAfterClick }, card) : [];
      if (sel.includes("button")) return button ? [{ innerText: button, click() { clicked = true; } }] : [];
      return [];
    },
  };
  const ctx = {
    document, location: { href: url }, window: { scrollBy() {} }, console, Date, Promise, encodeURIComponent,
    setInterval: (f) => setInterval(f, 0), clearInterval,
    setTimeout: (f) => setTimeout(f, 0),
    chrome: { tabs: {}, storage: { local: {} } },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(code + "\n;self.__tw = twitterDomScraper;", ctx);
  return ctx.__tw(1).then((r) => ({ r, clicked }));
}

let { r } = await run({ text: "PhiTech\n0 posts\n@somehandle hasn’t posted\nWhen they do, their posts will show up here.", empty: "@somehandle hasn’t posted" });
ok(!r.error && r.posts.length === 0, "never-posted account = 0 posts, not a scraper failure");

({ r } = await run({ text: "This account doesn’t exist\nTry searching for another." }));
ok(/^X_PROFILE_UNAVAILABLE: @somehandle/.test(r.error || "") && /renamed or deleted/.test(r.error), "renamed/deleted handle is named as a link to fix");

({ r } = await run({ text: "Account suspended\nX suspends accounts which violate the X Rules." }));
ok(/^X_PROFILE_UNAVAILABLE:.*suspended/.test(r.error || ""), "suspended account is named");

({ r } = await run({ text: "These posts are protected\nOnly approved followers can see @somehandle’s posts." }));
ok(/^X_PROFILE_PROTECTED/.test(r.error || ""), "protected account is named");

({ r } = await run({ text: "Don’t miss what’s happening\nPeople on X are the first to know.\nLog in\nSign up", loggedIn: false }));
ok(/login wall/.test(r.error || ""), "signed-out view is a login wall (auth), not a selector failure");

({ r } = await run({ text: "Something went wrong. Try reloading.\nRetry" }));
ok(/did not load/.test(r.error || "") && !/selectors/.test(r.error), "X error page is reported as a load failure");

const out = await run({ text: "Caution: This account is temporarily restricted", button: "Yes, view profile", cardsAfterClick: 1 });
ok(out.clicked && !out.r.error, "restricted-profile interstitial is clicked through, then read");

({ r } = await run({ text: "Some Company\n@somehandle\nJoined March 2020" }));
ok(/selectors may have changed/.test(r.error || ""), "no cards and no reason shown still reports a possible selector change");

({ r } = await run({ url: "https://x.com/i/flow/login?redirect_after_login=%2Fsomehandle" }));
ok(/login wall/.test(r.error || ""), "login-flow redirect still detected");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
