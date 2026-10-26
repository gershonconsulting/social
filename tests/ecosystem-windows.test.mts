// v4.65.0 — Social Dashboard/Summary period windows.
//   npx tsx --test tests/ecosystem-windows.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import * as wm from "../src/lib/ecosystem/windows.ts";
const W = ((wm as any).default ?? wm) as typeof wm;
const { ecoWindows, pctChange, daysBetween, firstLine, addDays } = W;

const byKey = (today: string) => Object.fromEntries(ecoWindows(today).map((w) => [w.key, w]));

test("five windows in the agreed order", () => {
  assert.deepEqual(ecoWindows("2026-10-26").map((w) => w.key), ["lastWeek", "lastMonth", "thisMonth", "thisYear", "allTime"]);
});

test("last week = 7 days incl. today vs the 7 before", () => {
  const w = byKey("2026-10-26").lastWeek;
  assert.deepEqual([w.from, w.to, w.prevFrom, w.prevTo], ["2026-10-20", "2026-10-26", "2026-10-13", "2026-10-19"]);
});

test("last month and this month compare like with like", () => {
  const k = byKey("2026-03-31");
  assert.deepEqual([k.lastMonth.from, k.lastMonth.to, k.lastMonth.prevFrom, k.lastMonth.prevTo], ["2026-02-01", "2026-02-28", "2026-01-01", "2026-01-31"]);
  // Mar 1–31 vs Feb 1–28 (capped at the end of a shorter month)
  assert.deepEqual([k.thisMonth.from, k.thisMonth.to, k.thisMonth.prevFrom, k.thisMonth.prevTo], ["2026-03-01", "2026-03-31", "2026-02-01", "2026-02-28"]);
  const j = byKey("2026-01-15");
  assert.deepEqual([j.lastMonth.from, j.lastMonth.to, j.lastMonth.prevFrom], ["2025-12-01", "2025-12-31", "2025-11-01"]);
  assert.deepEqual([j.thisMonth.prevFrom, j.thisMonth.prevTo], ["2025-12-01", "2025-12-15"]);
});

test("this year vs same span last year; leap day handled", () => {
  const w = byKey("2028-02-29").thisYear;
  assert.deepEqual([w.from, w.to, w.prevFrom, w.prevTo], ["2028-01-01", "2028-02-29", "2027-01-01", "2027-02-28"]);
});

test("all time has no comparison", () => {
  const w = byKey("2026-10-26").allTime;
  assert.equal(w.prevFrom, null);
  assert.equal(w.prevTo, null);
});

test("helpers", () => {
  assert.equal(pctChange(15, 10), 50);
  assert.equal(pctChange(5, 0), null);
  assert.equal(pctChange(5, null), null);
  assert.equal(daysBetween("2026-09-26", "2026-10-26"), 30);
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(firstLine("\n  Hello world  \nsecond"), "Hello world");
  assert.equal(firstLine("x".repeat(200), 10).length, 10);
});
