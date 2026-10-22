// Run: npx tsx --test tests/publish-browsers.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as pbm from "../src/lib/publish-browsers.ts";
import type { PublishBrowser } from "../src/lib/publish-browsers.ts";
const pb = ((pbm as any).default ?? pbm) as typeof pbm;
const { canPublish, shouldHandTo, targetStatus, liKey } = pb;

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
function br(id: string, p: Partial<PublishBrowser>): PublishBrowser {
  return { id, label: id, version: "0.25.0", lastSeenAt: iso(now - 60000), x: { signedIn: true, as: null, accounts: [] }, linkedin: { signedIn: true, name: null }, li: {}, ...p };
}
const GC_LI = "https://www.linkedin.com/company/gershonconsulting/";

test("liKey normalises", () => {
  assert.equal(liKey(GC_LI), "company/gershonconsulting");
  assert.equal(liKey("https://www.linkedin.com/groups/42835334/"), "groups/42835334");
});

test("X: only the browser holding the account gets the post", () => {
  const a = br("ag_aaaaaaaa", { x: { signedIn: true, as: "oattia", accounts: ["oattia"] } });
  const b = br("ag_bbbbbbbb", { x: { signedIn: true, as: "amphasys", accounts: ["amphasys", "gershoncons", "puentelatin"] } });
  assert.equal(canPublish(a, "TWITTER", "GershonCons"), false);
  assert.equal(canPublish(b, "TWITTER", "@GershonCons"), true);
  assert.equal(shouldHandTo("ag_aaaaaaaa", [a, b], "TWITTER", "GershonCons", now), false);
  assert.equal(shouldHandTo("ag_bbbbbbbb", [a, b], "TWITTER", "GershonCons", now), true);
  // legacy extension (no id) does not steal it either
  assert.equal(shouldHandTo(null, [a, b], "TWITTER", "GershonCons", now), false);
});

test("LinkedIn: admin browser wins; unknown browser may try when nobody is known", () => {
  const a = br("ag_aaaaaaaa", { li: { "company/gershonconsulting": { ok: false, at: iso(now) } } });
  const b = br("ag_bbbbbbbb", { li: { "company/gershonconsulting": { ok: true, at: iso(now) } } });
  const c = br("ag_cccccccc", {});
  assert.equal(shouldHandTo("ag_aaaaaaaa", [a, b, c], "LINKEDIN", GC_LI, now), false);
  assert.equal(shouldHandTo("ag_cccccccc", [a, b, c], "LINKEDIN", GC_LI, now), false);
  assert.equal(shouldHandTo("ag_bbbbbbbb", [a, b, c], "LINKEDIN", GC_LI, now), true);
  assert.equal(shouldHandTo("ag_cccccccc", [a, c], "LINKEDIN", GC_LI, now), true);
  assert.equal(shouldHandTo("ag_aaaaaaaa", [a, c], "LINKEDIN", GC_LI, now), false);
});

test("offline capable browser does not block an online one", () => {
  const off = br("ag_offline1", { lastSeenAt: iso(now - 3600000), li: { "company/gershonconsulting": { ok: true, at: iso(now) } } });
  const on = br("ag_online11", {});
  assert.equal(shouldHandTo("ag_online11", [off, on], "LINKEDIN", GC_LI, now), true);
  assert.equal(targetStatus([off, on], "LINKEDIN", GC_LI, now).level, "checking");
  assert.equal(targetStatus([off], "LINKEDIN", GC_LI, now).level, "offline");
});

test("status messages", () => {
  const a = br("ag_aaaaaaaa", { x: { signedIn: true, as: "oattia", accounts: ["oattia"] } });
  const s = targetStatus([a], "TWITTER", "GershonCons", now);
  assert.equal(s.level, "missing");
  assert.match(s.message, /Add an existing account/);
  assert.equal(targetStatus([a], "TWITTER", "oattia", now).level, "ok");
});
