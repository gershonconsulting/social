// v4.80.2 (nightly 2026-11-20): the internal daily digest says plainly when nothing was collected.
// Run: npx tsx tests/digest-headline.test.mts
import assert from "node:assert/strict";
import * as H from "../src/lib/reports/digest-headline.ts";
import * as RS from "../src/lib/reports/report-subject.ts";
const D = ((H as any).default ?? H) as typeof H;
const R = ((RS as any).default ?? RS) as typeof RS;

const day = "November 18, 2026";
const base = R.reportSubject(R.DIGEST_TITLE, undefined, day);

// Normal day: subject identical to the pre-4.80.2 format.
const ok = D.digestHeadline({ dayShort: day, posts: 42, companies: 10, heartbeat: { runs: 5, attempted: 60, upserted: 42, failed: 3 }, failureReasons: [] });
assert.equal(ok.noCollection, false);
assert.equal(ok.subject(base), R.reportSubject(R.DIGEST_TITLE, undefined, day, R.postsFromCompanies(42, 10)));
assert.equal(ok.headline, "42 posts collected on November 18, 2026 across 10 companies");

// Collector never reached the server.
const none = D.digestHeadline({ dayShort: day, posts: 0, companies: 0, heartbeat: null, failureReasons: [] });
assert.equal(none.noCollection, true);
assert.equal(none.cause, "did-not-run");
assert.equal(none.headline, "⚠ No collection on November 18, 2026 — 0 posts (collector did not run: no collection run reached the server)");
assert.equal(none.subject(base), "⚠ No collection on November 18, 2026 — 0 posts (collector did not run) — Report social.gershon.ai — Gershon Consulting — November 18, 2026");
assert.ok(!none.subject(base).includes("0 posts from 0 companies"));
// A heartbeat row with 0 runs is the same as none.
assert.equal(D.digestHeadline({ dayShort: day, posts: 0, companies: 0, heartbeat: { runs: 0, attempted: 0, upserted: 0, failed: 0 }, failureReasons: [] }).cause, "did-not-run");

// Collector ran (11-18: 13 runs, 20 failed) but stored nothing → failed, with top reason.
const reasons = D.groupReasons([
  "no posts found on the page (it may not have loaded)",
  "No posts found on the page  (it may not have loaded)",
  "posts are on the page but none could be read (LinkedIn layout changed again)",
  null, "",
]);
assert.deepEqual(D.topReasons(reasons).map((r) => r.n), [2, 1]);
const failed = D.digestHeadline({ dayShort: day, posts: 0, companies: 0, heartbeat: { runs: 13, attempted: 40, upserted: 0, failed: 20 }, failureReasons: reasons });
assert.equal(failed.cause, "failed");
assert.equal(failed.headline, "⚠ No collection on November 18, 2026 — 0 posts (collector failed: 13 runs, 20 failed attempts, 0 stored; top error: no posts found on the page (it may not have loaded))");
assert.ok(failed.subject(base).startsWith("⚠ No collection on November 18, 2026 — 0 posts (collector failed) — Report social.gershon.ai"));

// Singulars.
assert.equal(D.digestHeadline({ dayShort: day, posts: 1, companies: 1, heartbeat: null, failureReasons: [] }).headline, "1 post collected on November 18, 2026 across 1 company");
assert.ok(D.digestHeadline({ dayShort: day, posts: 0, companies: 0, heartbeat: { runs: 1, attempted: 1, upserted: 0, failed: 1 }, failureReasons: [] }).reason.includes("1 run, 1 failed attempt, 0 stored"));

console.log("digest-headline: all assertions passed");
