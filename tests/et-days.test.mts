// Pure unit test, no DB:  npx tsx tests/et-days.test.mts
// v4.78.4 (nightly 2026-11-15): ET day boundaries must not depend on the
// machine's time zone. Run it under several TZ values, e.g.
//   TZ=UTC npx tsx tests/et-days.test.mts
//   TZ=America/New_York npx tsx tests/et-days.test.mts
//   TZ=Europe/Paris npx tsx tests/et-days.test.mts
// Every run must print the same results.
const load = async (p: string) => { const m: any = await import(p); return { ...(m.default ?? {}), ...m }; };
const { etMidnight, etDayWindow, etDayKey, etDayLabel, etDayShort, etOffsetMs } = await load("../src/lib/reports/et-days.ts");
let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
const iso = (d: Date) => d.toISOString();
const H = 3600 * 1000;

console.log(`(process TZ = ${process.env.TZ ?? "(unset)"}, resolved ${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

console.log("1. ET offset comes from Intl alone");
ok(etOffsetMs(new Date("2026-01-15T12:00:00Z")) === -5 * H, "January = EST, UTC-5");
ok(etOffsetMs(new Date("2026-07-15T12:00:00Z")) === -4 * H, "July = EDT, UTC-4");
ok(etOffsetMs(new Date("2026-03-08T06:59:59Z")) === -5 * H && etOffsetMs(new Date("2026-03-08T07:00:00Z")) === -4 * H, "spring forward at 2026-03-08 02:00 EST = 07:00Z");
ok(etOffsetMs(new Date("2026-11-01T05:59:59Z")) === -4 * H && etOffsetMs(new Date("2026-11-01T06:00:00Z")) === -5 * H, "fall back at 2026-11-01 02:00 EDT = 06:00Z");

console.log("2. ordinary days");
const w = etDayWindow(1, new Date("2026-11-05T20:17:24Z"));
ok(iso(w.from) === "2026-11-04T05:00:00.000Z" && iso(w.to) === "2026-11-05T05:00:00.000Z", "Nov 4 ET = 05:00Z → 05:00Z (EST)");
const s = etDayWindow(1, new Date("2026-07-16T15:00:00Z"));
ok(iso(s.from) === "2026-07-15T04:00:00.000Z" && iso(s.to) === "2026-07-16T04:00:00.000Z", "Jul 15 ET = 04:00Z → 04:00Z (EDT)");

console.log("3. DST end (2026-11-01) is 25 hours");
const fall = etDayWindow(1, new Date("2026-11-02T15:00:00Z"));
ok(iso(fall.from) === "2026-11-01T04:00:00.000Z" && iso(fall.to) === "2026-11-02T05:00:00.000Z", `Nov 1 ET = ${iso(fall.from)} → ${iso(fall.to)}`);
ok(fall.to.getTime() - fall.from.getTime() === 25 * H, "25 h long");
ok(etDayKey(1, new Date("2026-11-02T15:00:00Z")) === "2026-11-01", "day key 2026-11-01");

console.log("4. DST start (2026-03-08) is 23 hours");
const spring = etDayWindow(1, new Date("2026-03-09T15:00:00Z"));
ok(iso(spring.from) === "2026-03-08T05:00:00.000Z" && iso(spring.to) === "2026-03-09T04:00:00.000Z", `Mar 8 ET = ${iso(spring.from)} → ${iso(spring.to)}`);
ok(spring.to.getTime() - spring.from.getTime() === 23 * H, "23 h long");
ok(etDayKey(1, new Date("2026-03-09T15:00:00Z")) === "2026-03-08", "day key 2026-03-08");

console.log("5. 'now' right after ET midnight / across the change");
ok(iso(etMidnight(0, new Date("2026-11-01T04:30:00Z"))) === "2026-11-01T04:00:00.000Z", "00:30 EDT on Nov 1 → today = 04:00Z");
ok(iso(etMidnight(0, new Date("2026-11-01T07:30:00Z"))) === "2026-11-01T04:00:00.000Z", "02:30 EST on Nov 1 (after fall back) → today still 04:00Z");
ok(iso(etMidnight(0, new Date("2026-03-08T08:00:00Z"))) === "2026-03-08T05:00:00.000Z", "04:00 EDT on Mar 8 (after spring forward) → today = 05:00Z");
ok(iso(etMidnight(0, new Date("2026-11-05T04:59:59Z"))) === "2026-11-04T05:00:00.000Z", "23:59:59 ET on Nov 4 is still Nov 4");
ok(etDayKey(0, new Date("2026-11-05T05:00:00Z")) === "2026-11-05", "00:00 ET on Nov 5 is Nov 5");

console.log("6. labels");
ok(etDayShort(1, new Date("2026-11-02T15:00:00Z")) === "November 1, 2026", "short label");
ok(etDayLabel(1, new Date("2026-03-09T15:00:00Z")) === "Sunday, March 8, 2026", "long label");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
