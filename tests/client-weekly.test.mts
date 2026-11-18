// v4.80.0 — client workspace reports go out weekly, on Friday ET.
const load = async (p: string) => { const m: any = await import(p); return { ...(m.default ?? {}), ...m }; };
const { isClientReportDay, etWeekday } = await load("../src/lib/reports/ops/weekly.ts");
let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };
ok(isClientReportDay(new Date("2026-11-20T12:00:00Z")), "Fri 2026-11-20 8am ET = report day");
ok(!isClientReportDay(new Date("2026-11-19T12:00:00Z")), "Thu = no report");
ok(!isClientReportDay(new Date("2026-11-18T12:00:00Z")), "Wed = no report");
ok(isClientReportDay(new Date("2026-11-21T03:00:00Z")), "Sat 03:00Z = Fri 10pm ET = still Friday");
ok(etWeekday(new Date("2026-11-21T03:00:00Z")) === "Fri", "03:00Z Saturday UTC is still Friday in New York");
ok(!isClientReportDay(new Date("2026-11-20T04:30:00Z")), "Fri 04:30Z = Thu 11:30pm ET = no report");
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
