// v4.78.5 Friday pack goes out once per client per report Friday — no DB, no network:
//   npx tsx tests/friday-once.test.mts
// Replays the 2026-11-14 double batch: the late Friday run (00:17Z) and the
// Saturday catch-up (22:48Z) must resolve to the same report Friday, the same
// week and the same keys, so the second run sends nothing.
const load = async (p: string) => { const m: any = await import(p); return { ...(m.default ?? {}), ...m }; };
const { fridayReportDay, fridayWeekFor, fridaySentKey, fridayIdempotencyKey, sendOncePerReportDay, addDays, weekdayOf } = await load("../src/lib/reports/friday/once.ts");

let pass = 0, fail = 0;
const ok = (c: unknown, msg: string) => { if (c) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗", msg); } };

console.log("1. report Friday (ET) of a run");
const run1 = new Date("2026-11-14T00:17:20Z"); // Fri 19:17 ET — the scheduled 19:00Z run, ~5 h late
const run2 = new Date("2026-11-14T22:48:19Z"); // Sat 17:48 ET — the one-off Saturday line
ok(fridayReportDay(run1) === "2026-11-13", "00:17Z Nov 14 = Fri Nov 13 ET → report day 2026-11-13");
ok(fridayReportDay(run2) === "2026-11-13", "22:48Z Nov 14 = Sat Nov 14 ET → still report day 2026-11-13");
ok(fridayReportDay(new Date("2026-11-13T19:00:00Z")) === "2026-11-13", "on-time Friday 14:00 ET → 2026-11-13");
ok(fridayReportDay(new Date("2026-11-20T04:59:00Z")) === "2026-11-13", "Thu Nov 19 23:59 ET → previous Friday");
ok(fridayReportDay(new Date("2026-11-20T05:00:00Z")) === "2026-11-20", "Fri Nov 20 00:00 ET → new report day");
ok(fridayReportDay(new Date("2026-03-07T03:00:00Z")) === "2026-03-06", "Fri 22:00 EST before the DST change → that Friday");
ok(weekdayOf("2026-11-13") === 5 && addDays("2026-03-01", -1) === "2026-02-28", "calendar helpers");

console.log("2. one week window per report Friday");
const w1 = fridayWeekFor(fridayReportDay(run1)), w2 = fridayWeekFor(fridayReportDay(run2));
ok(JSON.stringify(w1) === JSON.stringify(w2), "both runs report the same week");
ok(w1.weekFrom === "2026-11-06" && w1.weekTo === "2026-11-12" && w1.prevFrom === "2026-10-30" && w1.prevTo === "2026-11-05", "week Nov 6 – Nov 12 (as the first batch), previous Oct 30 – Nov 5");

console.log("3. keys");
ok(fridaySentKey("company", "cli_1", "2026-11-13") === "company:cli_1:2026-11-13", "sent-marker key unchanged in shape (old Friday markers still count)");
ok(fridayIdempotencyKey("competitive", "cli_1", "2026-11-13") === "social-client-cli_1-competitive-2026-11-13", "Resend Idempotency-Key per client, kind, report Friday");

console.log("4. replay of the double batch");
const store: Record<string, string> = {};
const posted: { subject: string; key: string | null }[] = [];
const deps = {
  post: async (e: { subject: string }, key: string | null) => { posted.push({ subject: e.subject, key }); return { status: 200, text: "" }; },
  readSent: async () => ({ ...store }),
  markSent: async (k: string) => { store[k] = "2026-11-14T00:17Z → olivier@"; },
};
const pack = (["company", "competitive", "intelligence"] as const).map((kind) => ({ kind, subject: `Social.gershon.ai — VALOS — ${kind}`, html: "<p/>" }));
const first = await sendOncePerReportDay("valos", fridayReportDay(run1), pack, deps);
ok(first.every((r: any) => r.sent) && posted.length === 3, "first run sends the 3 e-mails");
ok(posted.every((p) => p.key && p.key.startsWith("social-client-valos-")), "each POST carries an Idempotency-Key");
const second = await sendOncePerReportDay("valos", fridayReportDay(run2), pack, deps);
ok(posted.length === 3 && second.every((r: any) => !r.sent && /already sent/.test(r.skipped)), "Saturday run sends nothing: 3 × already sent");
const nextWeek = await sendOncePerReportDay("valos", fridayReportDay(new Date("2026-11-20T19:00:00Z")), pack, deps);
ok(nextWeek.every((r: any) => r.sent) && posted.length === 6, "next Friday sends again");

console.log("5. lost marker → Resend 409 on the key counts as sent");
const posted2: (string | null)[] = [];
const sentKeys = new Set<string>();
const forgetful = {
  post: async (_e: unknown, key: string | null) => { posted2.push(key); if (key && sentKeys.has(key)) return { status: 409, text: "invalid_idempotent_request" }; if (key) sentKeys.add(key); return { status: 200, text: "" }; },
  readSent: async () => ({}), // marker read failed / was never written
  markSent: async () => { throw new Error("db down"); },
};
await sendOncePerReportDay("wallix", "2026-11-13", pack, forgetful);
const again = await sendOncePerReportDay("wallix", "2026-11-13", pack, forgetful);
ok(again.every((r: any) => !r.sent && !r.error && /Resend idempotency/.test(r.skipped)), "repeat within 24 h is reported as already sent, not as an error");

console.log("6. force and ?to= keep their v4.78.0 meaning");
const posted3: (string | null)[] = [];
const d3 = { post: async (_e: unknown, key: string | null) => { posted3.push(key); return { status: 200, text: "" }; }, readSent: async () => ({ ...store }), markSent: async () => {} };
const forced = await sendOncePerReportDay("valos", "2026-11-13", pack, d3, { force: true });
ok(forced.every((r: any) => r.sent) && posted3.every((k) => k === null), "force=1 re-sends, without an idempotency key");
const test = await sendOncePerReportDay("valos", "2026-11-13", pack, d3, { testOnly: true });
ok(test.every((r: any) => r.sent), "?to= test send ignores the marker");
const failing = await sendOncePerReportDay("x", "2026-11-13", pack.slice(0, 1), { ...d3, post: async () => ({ status: 500, text: "boom" }) });
ok(failing[0].error === "Resend 500: boom", "Resend error is reported, not marked sent");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
