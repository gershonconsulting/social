// Pure unit test, no DB:  npx tsx tests/one-count.test.mts
// v4.77.3 (nightly 2026-11-13): the daily digest, the Social Collection Report
// and the Competitive report count "posts collected on an ET day" with ONE
// function (countCollected in src/lib/reports/collection-day.ts), so for the
// same fixture day they must print the same number.
import { readFileSync } from "node:fs";
const load = async (p: string) => { const m: any = await import(p); return { ...(m.default ?? {}), ...m }; };
const { countCollected, countCollectedByDay, postsCollectedOn, etDayOf } = await load("../src/lib/reports/collection-day.ts");
const { etDayKey, etDayWindow, etMidnight } = await load("../src/lib/reports/et-days.ts");
const { DIGEST_TITLE, reportSubject, postsFromCompanies, sourceFreshnessLine } = await load("../src/lib/reports/report-subject.ts");
let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

// Fixture: Nov 10, 2026 (EST, UTC-5) → ET day = [2026-11-10T05:00Z, 2026-11-11T05:00Z).
const P = (clientId: string, platform: string, externalPostId: string, createdAt: string, likes = 0) =>
  ({ clientId, platform, externalPostId, createdAt: new Date(createdAt), likeCount: likes, commentCount: 0, shareCount: 0, clientName: clientId.toUpperCase(), category: "CLIENT" });
const rows = [
  P("a", "LINKEDIN", "p1", "2026-11-10T03:00:00Z"),     // Nov 9 22:00 ET → Nov 9
  P("a", "LINKEDIN", "p2", "2026-11-10T06:00:00Z", 5),  // Nov 10 01:00 ET
  P("a", "TWITTER", "t1", "2026-11-10T21:00:00Z", 2),   // Nov 10 16:00 ET
  P("b", "LINKEDIN", "p3", "2026-11-11T02:00:00Z", 1),  // Nov 10 21:00 ET
  P("b", "LINKEDIN", "p3", "2026-11-11T03:00:00Z", 1),  // same post stored twice → deduped
  P("c", "TWITTER", "t2", "2026-11-10T19:30:00Z"),      // Nov 10 14:30 ET
  P("c", "LINKEDIN", "p4", "2026-11-11T05:30:00Z"),     // Nov 11 00:30 ET → Nov 11
];
const now = new Date("2026-11-11T20:00:00Z"); // both e-mails go out on Nov 11 (ET) and report Nov 10
const DAY = "2026-11-10";

console.log("1. the ET day bucket");
ok(etDayKey(1, now) === DAY, "yesterday (ET) on Nov 11 is 2026-11-10");
ok(etDayOf(new Date("2026-11-10T03:00:00Z")) === "2026-11-09", "03:00Z on Nov 10 is still Nov 9 in New York");
ok(etDayOf(new Date("2026-11-11T04:59:59Z")) === DAY && etDayOf(new Date("2026-11-11T05:00:00Z")) === "2026-11-11", "the day ends at 00:00 ET = 05:00Z");

console.log("2. digest and Collection Report give the SAME number for the fixture day");
// Digest path (src/app/api/digest/daily/route.ts): the DB loads [00:00 ET, 00:00 ET) of yesterday, then countCollected.
const w = etDayWindow(1, now);
const digestRows = rows.filter((r) => r.createdAt >= w.from && r.createdAt < w.to);
const digest = countCollected(digestRows, DAY).day;
// Collection Report path (src/lib/reports/daily-report.ts): the DB loads the last 8 ET days, then countCollectedByDay / countCollected.
const reportRows = rows.filter((r) => r.createdAt >= etMidnight(8, now) && r.createdAt < etMidnight(0, now));
const weekKeys = [1, 2, 3, 4, 5, 6, 7].map((i) => etDayKey(i, now));
const collection = countCollectedByDay(reportRows, weekKeys).get(DAY);
const collectionPerCompany = countCollected(reportRows, DAY).perCompany;
// Competitive report path (src/lib/reports/ops/competitive.ts): postsCollectedOn.
const competitive = postsCollectedOn(reportRows, DAY).length;
ok(digest.posts === 4 && digest.companies === 3, `digest: ${digest.posts} posts from ${digest.companies} companies (expected 4 / 3)`);
ok(collection.posts === digest.posts && collection.companies === digest.companies, `Collection Report headline: ${collection.posts} / ${collection.companies}`);
ok(collectionPerCompany.reduce((s: number, c: any) => s + c.n, 0) === digest.posts, "Collection Report per-company list adds up to the same headline");
ok(competitive === digest.posts, `Competitive daily count: ${competitive}`);
ok(digest.linkedin === 2 && digest.twitter === 2 && digest.engagement === 8, "platform split and engagement come from the same deduped rows");
ok(countCollected(rows, "2026-11-11").day.posts === 1, "the post stored at 00:30 ET belongs to the next day, not this one");

console.log("3. the bug it replaces: SQL `naive \"createdAt\" AT TIME ZONE 'America/New_York'` shifted the bucket by +5h instead of -5h");
const oldBucket = (d: Date) => new Date(d.getTime() + 5 * 3600 * 1000).toISOString().slice(0, 10);
const oldCount = rows.filter((r) => r.createdAt >= etMidnight(8, now) && r.createdAt < etMidnight(0, now) && oldBucket(r.createdAt) === DAY).length;
ok(oldCount !== digest.posts, `old headline bucket would have said ${oldCount} for the same day (the 76 vs 20 mismatch)`);

console.log("4. subject domain and footer");
ok(DIGEST_TITLE === "Report social.gershon.ai", DIGEST_TITLE);
ok(reportSubject(DIGEST_TITLE, undefined, "November 10, 2026", postsFromCompanies(4, 3)) === "Report social.gershon.ai — Gershon Consulting — November 10, 2026 — 4 posts from 3 companies", "digest subject");
const footer = sourceFreshnessLine({ site: "https://social.gershon.ai", dayKey: DAY, generatedAt: now });
ok(/^Source: social\.gershon\.ai/.test(footer) && /America\/New_York calendar day/.test(footer) && /deduped/.test(footer) && /Data as of Nov 11, 2026, 3:00 PM ET/.test(footer), footer);

console.log("5. no report keeps its own count");
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const all = ["src/lib/reports/collection-counts.ts", "src/lib/reports/daily-report.ts", "src/app/api/digest/daily/route.ts", "src/lib/reports/ops/competitive.ts"].map(src).join("\n");
ok(!/"createdAt" AT TIME ZONE 'America\/New_York'/.test(all), "no wrong-way AT TIME ZONE on createdAt left");
ok(/postsCollectedOn\(collected, key\)/.test(src("src/lib/reports/ops/competitive.ts")), "Competitive report counts via postsCollectedOn");
ok(!/gershonCRM/i.test(src("src/app/api/digest/daily/route.ts")), "digest route no longer says gershonCRM");
ok(/opsFooterText\(/.test(src("src/lib/reports/ops/shell.ts")) && /America\/New_York calendar days/.test(src("src/lib/reports/ops/shell.ts")), "ops reports (Posting, Competitive, Intelligence) footer has the day definition");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
