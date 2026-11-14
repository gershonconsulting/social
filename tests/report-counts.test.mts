// Pure unit test, no DB:  npx tsx tests/report-counts.test.mts
// The two daily collection e-mails ("Social Collection Report" and
// "Report social.gershon.ai") must count with ONE definition and share one
// subject format (nightly 2026-11-07).
import { readFileSync } from "node:fs";
// Loaded through import() + default so the test also runs where tsx hands .ts
// files to Node as CommonJS without named-export detection (Node 22.18+).
const load = async (p: string) => { const m: any = await import(p); return { ...(m.default ?? {}), ...m }; };
const { reportSubject, postsFromCompanies, sourceFreshnessLine, workspaceLabel, COLLECTION_DEFINITION, DIGEST_TITLE } = await load("../src/lib/reports/report-subject.ts");
const { etDayWindow, etDayKey, etDayShort } = await load("../src/lib/reports/et-days.ts");
let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

console.log("1. one day boundary: the America/New_York day");
const sentCollection = new Date("2026-11-05T19:11:18Z"); // Collection Report for Nov 4 went out then
const sentDigest = new Date("2026-11-05T20:17:24Z");     // a digest sent the same afternoon
ok(etDayKey(1, sentCollection) === "2026-11-04" && etDayKey(1, sentDigest) === "2026-11-04", "both e-mails sent on Nov 5 count Nov 4 (ET)");
const w = etDayWindow(1, sentDigest);
ok(w.from.toISOString() === "2026-11-04T05:00:00.000Z" && w.to.toISOString() === "2026-11-05T05:00:00.000Z", "Nov 4 ET = 05:00Z → 05:00Z (EST)");
const dst = etDayWindow(1, new Date("2026-11-02T15:00:00Z"));
ok(dst.from.toISOString() === "2026-11-01T04:00:00.000Z" && dst.to.toISOString() === "2026-11-02T05:00:00.000Z", "DST end day is 25 hours");

console.log("2. one subject format");
const day = etDayShort(1, sentDigest);
const collection = `${reportSubject("Social Collection Report", undefined, day)} — ${postsFromCompanies(19, 11)}`;
const digest = reportSubject(DIGEST_TITLE, undefined, day, postsFromCompanies(19, 11));
ok(collection === "Social Collection Report — Gershon Consulting — November 4, 2026 — 19 posts from 11 companies", collection);
ok(digest === "Report social.gershon.ai — Gershon Consulting — November 4, 2026 — 19 posts from 11 companies", digest);
ok(collection.split(" — ").slice(1).join(" — ") === digest.split(" — ").slice(1).join(" — "), "same workspace, day and counts after the title");
ok(postsFromCompanies(1, 1) === "1 post from 1 company", "singular");

console.log("3. Intelligence subject never drops the workspace");
ok(workspaceLabel(undefined) === "Gershon Consulting" && workspaceLabel("  ") === "Gershon Consulting", "missing name falls back to Gershon Consulting");
ok(workspaceLabel("VALOS") === "VALOS", "a client workspace keeps its own name");
ok(reportSubject("Social Intelligence Report", undefined, "November 5, 2026", "8 actions (1 high priority)") ===
  "Social Intelligence Report — Gershon Consulting — November 5, 2026 — 8 actions (1 high priority)", "same shape as the sent e-mails");

console.log("4. Source + freshness footer");
const line = sourceFreshnessLine({ site: "https://social.gershon.ai", dayKey: "2026-11-04", generatedAt: "2026-11-05T20:17:24Z", extra: "v4.69.0" });
ok(line === `Source: social.gershon.ai (Social app database: ${COLLECTION_DEFINITION}) · Counts for 2026-11-04 ET · Data as of Nov 5, 2026, 3:17 PM ET · v4.69.0`, line);

console.log("5. both builders use the shared count functions (no private copy left)");
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const collectionSrc = src("src/lib/reports/daily-report.ts");
const digestSrc = src("src/app/api/digest/daily/route.ts");
ok(/countCollectedByDay\(collected/.test(collectionSrc) && /countCollected\(collected, yKey\)/.test(collectionSrc), "Collection Report counts via countCollected (v4.77.3)");
ok(/countCollected\(await loadCollectedPosts\(orgId, from, to\), win\.dayKey\)/.test(digestSrc) && /collectionWindow\(1, now\)/.test(digestSrc), "digest counts via countCollected, ET yesterday");
ok(!/24 \* 60 \* 60 \* 1000\);\s*\n\s*\/\/ v4\.65\.2/.test(digestSrc) && !/const from = new Date\(now\.getTime\(\) - 24/.test(digestSrc), "digest no longer uses a rolling 24h window");
ok(!/FROM social_posts\n\s+WHERE "createdAt"/.test(collectionSrc), "Collection Report no longer counts every workspace");
ok(/reportSubject\(/.test(src("src/lib/reports/daily-report-render.ts")), "Collection Report uses the shared subject format");
ok(/workspaceLabel\(await workspaceName\(org\)\)/.test(src("src/lib/reports/ops/index.ts")), "ops reports (Intelligence, Posting, Competitive) always get a workspace name");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
