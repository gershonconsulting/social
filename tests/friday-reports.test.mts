// v4.78.0 Friday client reports — no DB:  npx tsx --tsconfig tests/tsconfig.test.json tests/friday-reports.test.mts
const m = <T,>(x: T): T => ((x as { default?: T }).default ?? x);
const { statsFor, compare, trend, topicOf } = m(await import("../src/lib/reports/friday/analyze"));
const { parseFridayIntel, fallbackFridayIntel } = m(await import("../src/lib/reports/friday/intel"));
const { renderCompany, renderCompetitive, renderIntelligence, fridaySubject } = m(await import("../src/lib/reports/friday/render"));
import { writeFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c: unknown, msg: string) => { if (c) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗", msg); } };

const w = { weekFrom: "2026-11-07", weekTo: "2026-11-13", prevFrom: "2026-10-31", prevTo: "2026-11-06" };
let n = 0;
const post = (companyId: string, company: string, role: "self" | "competitor", date: string, text: string, likes = 10, comments = 1, shares = 0) => ({
  id: `p${++n}`, companyId, company, role, platform: n % 3 ? "LINKEDIN" : "X", date, text, hashtagsCol: null, hasMedia: n % 2 === 0, likes, comments, shares, url: `https://www.linkedin.com/feed/update/${n}`,
});
const posts = [
  post("c", "VALOS", "self", "2026-11-10", "Join our webinar on adaptive trial design #biostatistics", 40, 5, 2),
  post("c", "VALOS", "self", "2026-11-12", "New case study: how a client saved six months with Bayesian methods", 20, 2),
  post("c", "VALOS", "self", "2026-11-03", "We are hiring a senior statistician", 5),
  post("a", "Cytel", "competitor", "2026-11-08", "Cytel launches new adaptive design software release for sponsors", 120, 12, 9),
  post("a", "Cytel", "competitor", "2026-11-11", "Meet us at the conference booth — adaptive design software demo", 60, 4, 1),
  post("b", "Veramed", "competitor", "2026-11-09", "Our report on estimands and regulatory guidance", 15, 1),
  post("b", "Veramed", "competitor", "2026-10-20", "old post outside both weeks", 999),
];

console.log("1. per-company stats");
const self = statsFor({ id: "c", name: "VALOS", role: "self" }, posts, w, "2026-11-12");
ok(self.postsWeek === 2 && self.postsPrev === 1, "VALOS: 2 posts this week, 1 last week");
ok(self.engagementWeek === 40 + 10 + 6 + 20 + 4, "engagement = likes + 2×comments + 3×shares");
ok(self.topPosts[0].text.startsWith("Join our webinar"), "best post first");
const cytel = statsFor({ id: "a", name: "Cytel", role: "competitor" }, posts, w, "2026-11-11");
const vera = statsFor({ id: "b", name: "Veramed", role: "competitor" }, posts, w, "2026-11-09");
ok(vera.postsWeek === 1 && vera.postsPrev === 0, "posts outside both weeks are ignored");
ok(topicOf("Meet us at the conference booth") === "Events & webinars", "rule-based topic");

console.log("2. comparison");
const c = compare(self, [cytel, vera]);
ok(c.rankByEngagement === 2 && c.shareOfVoice[0].name === "Cytel", "Cytel leads engagement, VALOS #2");
ok(c.shareOfVoice.reduce((a, x) => a + x.posts, 0) === 5, "share of voice counts every post of the week");
ok(c.gaps.some((g) => g.term === "software"), "keyword gap: 'software' used by a competitor, not VALOS");
ok(trend(2, 1) === "+100%" && trend(0, 3) === "−100%" && trend(3, 0) === "new" && trend(1, 1) === "=", "trend labels");

console.log("3. Intelligence parsing + fallback");
const samples = [{ id: 1, url: "https://x/1" }, { id: 2, url: "https://x/2" }];
const parsed = parseFridayIntel('Sure: {"headline":"H","insights":[{"title":"T","detail":"D","basedOn":"Cytel (#2)"}],"actions":[{"action":"Comment on Cytel software launch","why":"w","basedOn":"Cytel — launch (#2)","pillar":"Engage","priority":"high"}],"postIdeas":[],"watch":[]}', samples);
ok(parsed?.actions[0].url === "https://x/2", "post id in basedOn becomes the post link");
ok(parsed?.actions[0].pillar === "Engage" && parsed?.actions[0].priority === "high", "pillar + priority kept");
ok(parseFridayIntel("not json", samples) === null, "unreadable answer → null (fallback used)");
const data = { orgId: "o", dayKey: "2026-11-14", window: w, weekLabel: "Nov 7 – Nov 13", client: { id: "c", name: "VALOS", clientType: "CAMPAIGN", industry: null, about: "Biostatistics CRO" }, self, competitors: [cytel, vera], comparison: c, weekPosts: posts.filter((p) => p.date >= w.weekFrom) };
const fb = fallbackFridayIntel(data);
ok(fb.insights.length >= 2 && fb.actions.length >= 1, "fallback still gives insights and actions");

console.log("4. e-mails");
ok(fridaySubject("competitive", data) === "Social.gershon.ai — VALOS — Competitive report (week of Nov 7 – Nov 13)", "subject format");
const comp = renderCompany(data), cmp = renderCompetitive(data), intel = renderIntelligence(data, { intel: fb, ai: false, model: null, note: "rule-based" });
ok(comp.includes("2 posts") && comp.includes("Open the post"), "Company report shows the week and links the posts");
ok(cmp.includes("ranks #2 of 3") && cmp.includes("Cytel"), "Competitive report ranks the client");
ok(intel.includes("Based on:"), "Intelligence shows what each insight is based on");
ok(renderCompetitive({ ...data, competitors: [] }).includes("No competitor linked"), "no competitor → clear setup message");
writeFileSync("/tmp/friday-company.html", comp); writeFileSync("/tmp/friday-competitive.html", cmp); writeFileSync("/tmp/friday-intelligence.html", intel);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
