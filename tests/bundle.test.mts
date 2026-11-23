// v4.82.0: report bundling — Daily brief, Friday pack, monthly categories in one email.
// Run: npx tsx tests/bundle.test.mts
import assert from "node:assert/strict";
import * as C0 from "../src/lib/reports/bundle/combine.ts";
const C = ((C0 as any).default ?? C0) as typeof C0;

// bodyOf: keeps the body, drops head/style/script/title.
const full = `<!DOCTYPE html><html><head><title>T</title><style>.x{}</style></head><body style="a"><div>Hello</div><script>x()</script></body></html>`;
assert.equal(C.bodyOf(full), "<div>Hello</div>");
assert.equal(C.bodyOf("<div>frag</div>"), "<div>frag</div>");
assert.equal(C.bodyOf(""), "");

// combineEmail: one document, TOC with anchors, sections in order, banner.
const html = C.combineEmail({
  title: "Daily brief",
  alerts: [{ level: "critical", text: "No collection <yesterday>" }],
  sections: [
    { id: "collection", title: "Collection", html: full },
    { id: "posting", title: "Posting", html: "<p>P</p>" },
    { id: "empty", title: "Empty", html: "  " },
  ],
});
assert.equal((html.match(/<body/g) || []).length, 1, "one body only");
assert.equal((html.match(/<html/g) || []).length, 1, "one html only");
assert.ok(html.includes('href="#collection"') && html.includes('id="posting"'));
assert.ok(html.indexOf("Hello") < html.indexOf("<p>P</p>"), "order kept");
assert.ok(!html.includes('id="empty"'), "empty sections dropped");
assert.ok(html.includes("No collection &lt;yesterday&gt;"), "alert escaped");
assert.ok(html.includes("Needs attention now"));
assert.ok(!html.includes("<script>"));
// single section → no TOC
assert.ok(!C.combineEmail({ title: "x", sections: [{ id: "a", title: "A", html: "<p>a</p>" }] }).includes("In this email"));

// Subject: the collection verdict leads.
const sub = (o: Partial<Parameters<typeof C.dailyBriefSubject>[0]>) =>
  C.dailyBriefSubject({ day: "Nov 22", workspace: "Gershon Consulting", collectionLevel: "ok", alerts: 0, ...o });
assert.equal(sub({ tail: "57 posts from 12 companies" }), "Social.gershon.ai — Gershon Consulting — Daily brief — Nov 22 — 57 posts from 12 companies");
assert.ok(sub({ collectionLevel: "critical" }).startsWith("⛔ NO COLLECTION — "));
assert.ok(sub({ extensionCritical: true }).startsWith("⚠️ Extension out of date — "));
assert.ok(sub({ alerts: 1 }).startsWith("⚠️ Social.gershon.ai"));

// Friday pack: one row per client, 3 links each, sorted, quiet clients flagged.
const data = (id: string, name: string, posts: number, comps = 2) => ({
  client: { id, name, clientType: "CAMPAIGN" },
  self: { postsWeek: posts, postsPrev: 3, engagementWeek: 40, mainTopic: "Product" },
  competitors: Array.from({ length: comps }),
  comparison: { rankByPosts: 2, gaps: [{ term: "ai" }, { term: "cloud" }, { term: "data" }, { term: "extra" }] },
});
const e1 = C.packEntryFrom(data("c1", "Wallix", 5), "https://social.gershon.ai");
assert.equal(e1.links.company, "https://social.gershon.ai/api/report/friday?client=c1&kind=company");
assert.equal(e1.links.intelligence, "https://social.gershon.ai/api/report/friday?client=c1&kind=intelligence");
assert.equal(e1.rank, 2);
assert.ok(e1.headline.includes("ai, cloud, data") && !e1.headline.includes("extra"));
const e0 = C.packEntryFrom(data("c2", "Altavia", 0, 0), "https://social.gershon.ai");
assert.equal(e0.rank, null);
const pack = C.fridayPackHtml({ weekLabel: "Nov 13 – Nov 19", entries: [e1, e0], site: "https://social.gershon.ai" });
assert.equal((pack.match(/Company report/g) || []).length, 2);
assert.ok(pack.indexOf("Altavia") < pack.indexOf("Wallix"), "sorted by name");
assert.ok(pack.includes("No post collected this week for: Altavia"));
assert.ok(pack.includes("2 clients · 5 posts collected"));
assert.ok(pack.includes("+2 vs last week"));

console.log("bundle: all assertions passed");
