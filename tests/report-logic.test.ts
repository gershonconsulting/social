// Unit tests for the report e-mail logic fixed on 2026-10-22 (no database, no network).
// Run from the repo root:  npx tsx --test tests/report-logic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDigestPost, splitDigestPosts } from "../src/lib/reports/digest-window";
import { failureHealth, failureLine, FAIL_MAX } from "../src/lib/reports/collection-health";
import { etDateKey, etStartOfDay, etEndOfDay, judgeDays } from "../src/lib/alerts/days";

// ── 1. Daily digest: "last 24h" is by PUBLISH date ────────────────────────────
const to = new Date("2026-10-21T17:55:00Z");
const from = new Date(to.getTime() - 24 * 3600 * 1000);
const W = { from, to };

test("a post published in the window counts as last 24h", () => {
  assert.equal(classifyDigestPost({ createdAt: "2026-10-21T17:00:00Z", publishedAtUtc: "2026-10-21T11:32:00Z" }, W), "window");
});

test("the April 2024 Meteor Biotech post collected yesterday is NOT last 24h", () => {
  assert.equal(classifyDigestPost({ createdAt: "2026-10-21T16:00:00Z", publishedAtUtc: "2024-04-01T00:23:00Z" }, W), "older");
});

test("a post published a week ago but ingested today is back-fill", () => {
  assert.equal(classifyDigestPost({ createdAt: "2026-10-21T16:00:00Z", publishedAtUtc: "2026-10-05T07:23:00Z" }, W), "older");
});

test("no publish date → unknown, never last 24h", () => {
  assert.equal(classifyDigestPost({ createdAt: "2026-10-21T16:00:00Z", publishedAtUtc: null }, W), "unknown");
  assert.equal(classifyDigestPost({ createdAt: "2026-10-21T16:00:00Z", publishedAtUtc: "not a date" }, W), "unknown");
});

test("publish date stamped at ingestion (ingest fallback = new Date()) → unknown", () => {
  assert.equal(classifyDigestPost({ createdAt: "2026-10-21T16:00:00.120Z", publishedAtUtc: "2026-10-21T16:00:00.050Z" }, W), "unknown");
  // re-collected later: publish date overwritten with a time after the row was created
  assert.equal(classifyDigestPost({ createdAt: "2026-10-21T08:00:00Z", publishedAtUtc: "2026-10-21T15:00:00Z" }, W), "unknown");
});

test("publish date in the future → unknown", () => {
  assert.equal(classifyDigestPost({ createdAt: null, publishedAtUtc: "2026-10-23T10:00:00Z" }, W), "unknown");
});

test("window boundaries: exactly `from` is in, one second before is older", () => {
  assert.equal(classifyDigestPost({ createdAt: to, publishedAtUtc: from }, W), "window");
  assert.equal(classifyDigestPost({ createdAt: to, publishedAtUtc: new Date(from.getTime() - 1000) }, W), "older");
});

test("splitDigestPosts keeps every post exactly once", () => {
  const posts = [
    { id: 1, createdAt: "2026-10-21T17:00:00Z", publishedAtUtc: "2026-10-21T11:00:00Z" },
    { id: 2, createdAt: "2026-10-21T17:00:00Z", publishedAtUtc: "2024-04-01T00:23:00Z" },
    { id: 3, createdAt: "2026-10-21T17:00:00Z", publishedAtUtc: null },
    { id: 4, createdAt: "2026-10-21T17:00:00Z", publishedAtUtc: "2026-10-20T20:00:00Z" },
  ];
  const s = splitDigestPosts(posts, W);
  assert.deepEqual(s.window.map((p) => p.id), [1, 4]);
  assert.deepEqual(s.older.map((p) => p.id), [2]);
  assert.deepEqual(s.unknown.map((p) => p.id), [3]);
});

// ── 2. Collection report: health from failed attempts ────────────────────────
test("20 Oct case: 155 failed vs 17 the day before → degraded", () => {
  const h = failureHealth({ failed: 155, previous: [17, 30, 25, 40, 35, 28, 33] });
  assert.equal(h.level, "degraded");
  assert.match(failureLine(h), /155 failed collection attempts \(\+\d+% vs the usual \d+\)/);
});

test("a normal day stays healthy", () => {
  assert.equal(failureHealth({ failed: 17, previous: [20, 15, 22, 18, 25, 19, 21] }).level, "ok");
  assert.equal(failureHealth({ failed: 0, previous: [0, 0, 0] }).level, "ok");
});

test("over the absolute limit is degraded even without a spike", () => {
  assert.equal(failureHealth({ failed: FAIL_MAX, previous: [60, 60, 60] }).level, "degraded");
});

test("a spike must be both 2× and +20 to count", () => {
  assert.equal(failureHealth({ failed: 12, previous: [5, 5, 5] }).level, "ok"); // 2.4× but only +7
  assert.equal(failureHealth({ failed: 45, previous: [20, 20, 20] }).level, "degraded"); // 2.25× and +25
  assert.equal(failureHealth({ failed: 35, previous: [20, 20, 20] }).level, "ok"); // +15, 1.75×
});

test("no history: absolute limit still applies; no heartbeat = unknown", () => {
  assert.equal(failureHealth({ failed: 30, previous: [] }).level, "ok");
  assert.equal(failureHealth({ failed: 80, previous: [null, null] }).level, "degraded");
  assert.equal(failureHealth({ failed: null, previous: [10] }).level, "unknown");
});

test("baseline uses at most the 7 days before", () => {
  const h = failureHealth({ failed: 10, previous: [10, 10, 10, 10, 10, 10, 10, 1000] });
  assert.equal(h.baseline, 10);
});

// ── 3. Weekly posting check: New York days, not-yet-collected, cadence ──────
test("a 21:30 ET post on Wed 14 Oct is a Wednesday post (UTC date says Thursday)", () => {
  const d = new Date("2026-10-15T01:30:00Z"); // 21:30 EDT on the 14th
  assert.equal(d.toISOString().slice(0, 10), "2026-10-15");
  assert.equal(etDateKey(d), "2026-10-14");
});

test("ET day boundaries, including the November DST change", () => {
  assert.equal(etStartOfDay("2026-10-14").toISOString(), "2026-10-14T04:00:00.000Z");
  assert.equal(etEndOfDay("2026-10-16").toISOString(), "2026-10-17T04:00:00.000Z");
  assert.equal(etStartOfDay("2026-11-02").toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(etEndOfDay("2026-10-31").toISOString(), "2026-11-01T04:00:00.000Z");
});

const WEEK = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

test("WALLIX-like: not collected since before the week → nothing is a miss, all pending", () => {
  const j = judgeDays({ expected: WEEK, postedDays: new Set(), lastReadAt: new Date("2026-10-09T15:00:00Z"), perWeek: 3 });
  assert.equal(j.daysMissed, 0);
  assert.equal(j.pendingDates.length, 5);
  assert.equal(j.objectiveDays, 3);
});

test("WALLIX after the 21 Oct collection: 5 posts on Wed 14 Oct → 1 of 3 days met, 2 missed", () => {
  const j = judgeDays({ expected: WEEK, postedDays: new Set(["2026-10-14"]), lastReadAt: new Date("2026-10-21T16:00:00Z"), perWeek: 3 });
  assert.equal(j.flexible, true);
  assert.equal(j.objectiveDays, 3);
  assert.equal(j.daysMet, 1);
  assert.equal(j.daysMissed, 2);
});

test("3/week objective met on any 3 days → no miss", () => {
  const j = judgeDays({ expected: WEEK, postedDays: new Set(["2026-10-12", "2026-10-14", "2026-10-16"]), lastReadAt: new Date("2026-10-19T12:00:00Z"), perWeek: 3 });
  assert.equal(j.daysMet, 3);
  assert.equal(j.daysMissed, 0);
  assert.deepEqual(j.missedDates, []);
});

test("Friday-evening run: Friday not read yet → pending, Mon–Thu judged", () => {
  const readFri1920 = new Date("2026-10-16T23:20:00Z");
  const j = judgeDays({ expected: WEEK, postedDays: new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]), lastReadAt: readFri1920 });
  assert.equal(j.objectiveDays, 5);
  assert.equal(j.daysMet, 4);
  assert.equal(j.daysMissed, 0);
  assert.deepEqual(j.pendingDates, ["2026-10-16"]);
});

test("5/week company read after the week: unposted days are real misses", () => {
  const j = judgeDays({ expected: WEEK, postedDays: new Set(["2026-10-14", "2026-10-15"]), lastReadAt: new Date("2026-10-17T12:00:00Z"), perWeek: 5 });
  assert.equal(j.flexible, false);
  assert.deepEqual(j.missedDates, ["2026-10-12", "2026-10-13", "2026-10-16"]);
  assert.equal(j.daysMissed, 3);
});

test("never collected → every unposted day pending, no miss", () => {
  const j = judgeDays({ expected: WEEK, postedDays: new Set(), lastReadAt: null });
  assert.equal(j.daysMissed, 0);
  assert.equal(j.pendingDates.length, 5);
});
