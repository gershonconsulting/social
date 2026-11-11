// Settings → Reports (v4.71.0): frequency rules and email cleaning.
// Run: npx tsx --test tests/report-settings.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";
// settings.ts loads as CommonJS under tsx (it imports prisma), so read its exports off the namespace.
const ns: any = await import("../src/lib/reports/settings");
const { isDueToday, cleanEmails, allowedFrequencies, REPORT_CATALOG, reportDef } = ns.REPORT_CATALOG ? ns : ns.default;

const MON = new Date("2026-11-09T13:00:00Z"); // Monday 08:00 New York
const SAT = new Date("2026-11-07T13:00:00Z");
const FIRST = new Date("2026-12-01T13:00:00Z"); // Tuesday Dec 1
const LATE_SUN = new Date("2026-11-09T03:00:00Z"); // still Sunday Nov 8 in New York

test("daily job: frequencies", () => {
  assert.equal(isDueToday("daily", "daily", SAT), true);
  assert.equal(isDueToday("weekdays", "daily", SAT), false);
  assert.equal(isDueToday("weekdays", "daily", MON), true);
  assert.equal(isDueToday("weekly", "daily", MON), true);
  assert.equal(isDueToday("weekly", "daily", SAT), false);
  assert.equal(isDueToday("weekly", "daily", LATE_SUN), false, "uses the New York day, not UTC");
  assert.equal(isDueToday("monthly", "daily", FIRST), true);
  assert.equal(isDueToday("monthly", "daily", MON), false);
  assert.equal(isDueToday("off", "daily", MON), false);
});

test("weekly / monthly / event jobs only obey Off", () => {
  assert.equal(isDueToday("weekly", "weekly", SAT), true);
  assert.equal(isDueToday("monthly", "monthly", MON), true);
  assert.equal(isDueToday("on", "event", MON), true);
  assert.equal(isDueToday("off", "event", MON), false);
});

test("email cleaning", () => {
  assert.deepEqual(cleanEmails("A@x.com, b@y.com; a@x.com  bad"), ["a@x.com", "b@y.com"]);
  assert.deepEqual(cleanEmails(["c@d.co"]), ["c@d.co"]);
  assert.deepEqual(cleanEmails(""), []);
});

test("catalog is consistent", () => {
  const ids = REPORT_CATALOG.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of REPORT_CATALOG) assert.ok(allowedFrequencies(r).includes(r.defaultFrequency), r.id);
  assert.deepEqual(allowedFrequencies(reportDef("posting-alert-week")!), ["weekly", "off"]);
  assert.equal(REPORT_CATALOG.filter((r) => r.group !== "Alerts").length, 9);
  // [19] "Still missing today" e-mail was removed (PR #23/#25) — no dead Settings entry.
  assert.equal(reportDef("missing-today"), undefined);
});
