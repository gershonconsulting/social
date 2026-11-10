// v4.70.0 action cards — no DB:  NEXTAUTH_SECRET=x npx tsx tests/actions.test.mts
const m = <T,>(x: T): T => ((x as { default?: T }).default ?? x);
const { pillarOf, cardId } = m(await import("../src/lib/actions/store"));
const { signAction, verifyAction } = m(await import("../src/lib/actions/token"));
const { intelToCards, systemFor } = m(await import("../src/lib/reports/ops/intelligence"));
const { cardsEmailHtml, resultsEmailHtml } = m(await import("../src/lib/actions/render"));
const { renderCompetitive } = m(await import("../src/lib/reports/ops/competitive"));
import { writeFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗", m); } };

console.log("1. pillars");
ok(pillarOf("Comment on Cytel's webinar post with our view on adaptive trials") === "ENGAGE", "comment → Engage");
ok(pillarOf("Reach out to the French Tech NYC team to propose a joint session") === "NETWORK", "reach out → Network");
ok(pillarOf("Publish a post on retail media measurement, the topic Acosta covered") === "PROMOTE", "publish → Promote");

console.log("2. ids are stable and day-bound");
ok(cardId("2026-11-04", "PROMOTE", "Post X") === cardId("2026-11-04", "PROMOTE", " post x "), "same day + text = same card");
ok(cardId("2026-11-04", "PROMOTE", "Post X") !== cardId("2026-11-05", "PROMOTE", "Post X"), "another day = another card");

console.log("3. signed links");
const t = await signAction("org1", "c1", "done");
ok(await verifyAction("org1", "c1", "done", t), "valid signature accepted");
ok(!(await verifyAction("org1", "c1", "dismissed", t)), "signature cannot change another status");
ok(!(await verifyAction("org2", "c1", "done", t)), "signature cannot be used on another workspace");

console.log("4. Intelligence → cards");
const intel = {
  headline: "h", insights: [], watch: [],
  actions: [
    { action: "Publish a post on retail media 101 for mid-size retailers", forCompany: "Altavia North America", why: "Acosta got 300 engagements on it", basedOn: "Acosta — retail media (#2)", priority: "high" as const, links: [{ label: "Open Acosta's post", href: "https://www.linkedin.com/feed/update/1" }] },
    { action: "Reach out to Advantage's event team about NRF", forCompany: "", why: "w", basedOn: "b", priority: "medium" as const },
  ],
  engage: [{ company: "VML", post: "Retail media is the new shelf", how: "We see the same with mid-size retailers — what about measurement?", url: "https://www.linkedin.com/feed/update/2" }],
  postIdeas: [{ forCompany: "Altavia North America", hook: "Retail media is not only for giants", angle: "Mid-size retailers can start with 3 screens" }],
};
const ourId = new Map([["altavia north america", "cl_alt"]]);
const cards = intelToCards(intel, "2026-11-04", "Altavia North America", ourId);
ok(cards.length === 4, "2 actions + 1 engage + 1 idea = 4 cards");
ok(cards[0].pillar === "PROMOTE" && cards[0].forCompanyId === "cl_alt" && cards[0].postUrl?.includes("linkedin"), "action → Promote with company id and post url");
ok(cards[1].pillar === "NETWORK" && cards[1].forCompany === "Altavia North America", "empty forCompany → own company");
ok(cards[2].pillar === "ENGAGE" && cards[2].draft?.startsWith("We see"), "engage carries the comment as draft");

console.log("5. prompt per workspace");
const sp = systemFor(false, "VALOS");
ok(systemFor(true, "Gershon Consulting").includes("analyst of Gershon Consulting"), "primary prompt unchanged");
ok(sp.startsWith("You are the competitive-intelligence analyst of VALOS."), "other workspace framed around its company");
ok(!/Gershon/.test(sp), `no "Gershon" left in a client workspace prompt${/Gershon/.test(sp) ? ": " + sp.match(/.{40}Gershon.{40}/)?.[0] : ""}`);

console.log("6. email render");
const full = cards.map((c, i) => ({ ...c, id: `id${i}`, status: "open" as const, createdAt: new Date().toISOString(), doneAt: null, dismissedAt: null, publishItemId: null }));
const html = await cardsEmailHtml("org1", full);
ok(html.includes("PROMOTE".charAt(0) + "romote") && html.includes("Network") && html.includes("Engage"), "three pillars rendered");
ok((html.match(/api\/report\/action\?o=org1/g) || []).length === 8, "Done + Dismiss signed link on each of 4 cards");
const res = resultsEmailHtml({ window: { from: "", to: "" }, created: 6, done: 2, dismissed: 1, open: 3, byPillar: { PROMOTE: { created: 3, done: 1 }, NETWORK: { created: 1, done: 0 }, ENGAGE: { created: 2, done: 1 } }, results: [{ card: full[0], postsAfter: 2, postsPerWeekBefore: 1.5, engagementPerPostAfter: 40, engagementPerPostBefore: 22, inProgress: true }] });
ok(res.includes("2</b> posts") && res.includes("40 engagements per post (usually 22)"), "results line");
const comp = {
  dayKey: "2026-11-04", dayShort: "Wed, Nov 4",
  companies: { competitors: 4, partners: 1 },
  daily: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ key: `2026-10-${28 + (n % 3)}`, competitors: n, partners: 1, linkedin: n, x: 1, total: n + 1 })),
  weekly: [0, 1, 2, 3].map((w) => ({ label: `W${w}`, competitors: 10, partners: 2, total: 12 })),
  week: { published: 20, topics: [{ label: "Events & webinars", count: 8, share: 40 }], withMedia: 10, withLink: 5, textOnly: 5, hashtags: [], keywords: [], topPosts: [] },
  rows: [{ id: "c1", name: "Acosta", kind: "COMPETITION" as const, watchedFor: [], collectedWeek: 3, collectedPrevWeek: 2, publishedWeek: 3, lastPostKey: "2026-11-03", mainTopic: "Events & webinars", engagementWeek: 300 }],
  silent: [], level: "ok" as const,
};
const page = renderCompetitive(comp, { cardsHtml: html, resultsHtml: res, ownName: "Altavia North America", isPrimary: false });
ok(page.includes("Altavia North America — our own market"), "own-market group named after the workspace's company");
ok(page.includes("Last week&#39;s actions") || page.includes("Last week's actions"), "results section present");
ok(page.includes("/actions") && !page.includes("kind=intelligence"), "CTA to /actions, no public Intelligence link for a client workspace");
writeFileSync("/tmp/competitive-v4.70.0-sample.html", page);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
