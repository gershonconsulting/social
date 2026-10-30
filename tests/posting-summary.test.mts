// Pure unit test, no DB:  npx tsx tests/posting-summary.test.mts
import { postingSummary, yesterdayCounts } from "../src/lib/reports/ops/posting-summary";
let pass = 0, fail = 0;
const ok = (c: any, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

// The Resend case: 12 companies, 11 due, 8 due ones posted, 3 missed, 1 posted while not due.
const rows = [
  ...Array.from({ length: 8 }, () => ({ yesterday: { expected: true, count: 1 } })),
  ...Array.from({ length: 3 }, () => ({ yesterday: { expected: true, count: 0 } })),
  { yesterday: { expected: false, count: 2 } },
];
const c = yesterdayCounts(rows);
console.log("1. counts share one denominator");
ok(c.companies === 12 && c.due === 11, "12 companies, 11 due");
ok(c.postedDue === 8 && c.missed === 3 && c.postedDue + c.missed === c.due, "8 posted + 3 missed = 11 due");
ok(c.postedNotDue === 1 && c.posted === 9, "1 extra posted while not due, 9 posted overall");

const s = postingSummary(c, "Wed, Oct 29, 2026");
console.log("2. headline and tiles agree");
ok(s.headline === "3 of 11 companies due on Wed, Oct 29, 2026 did NOT post", "headline: 3 of 11");
ok(s.posted.value === "8/11", "posted tile 8/11 (was 9/12)");
ok(s.missed.value === "3/11", "missed tile 3/11");
ok(s.posted.label === "Posted Wed, Oct 29 (of due)", "posted label names the denominator");
ok(s.posted.hint === "+1 posted while not due", "extra post shown as hint only");
const den = (v: string) => v.split("/")[1];
ok(den(s.posted.value) === "11" && den(s.missed.value) === "11" && s.headline.includes("of 11"), "same denominator everywhere");
ok(s.subjectTail === "3 of 11 due companies did not post", "subject uses the same counts");

console.log("3. all posted / non-posting day");
const all = postingSummary(yesterdayCounts(rows.slice(0, 8)), "Wed, Oct 29, 2026");
ok(all.headline === "All 8 companies due on Wed, Oct 29, 2026 posted" && all.posted.value === "8/8" && all.missed.value === "0/8", "all due posted");
const wk = postingSummary(yesterdayCounts([{ yesterday: { expected: false, count: 1 } }, { yesterday: { expected: false, count: 0 } }]), "Sun, Oct 26, 2026");
ok(wk.headline.includes("not a posting day") && wk.headline.includes("1 of 2") && wk.posted.value === "1/2", "weekend: 1 of 2 in headline and tile");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
