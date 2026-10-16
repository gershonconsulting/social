/**
 * Report 4 — COMPETITIVE: what we collect from competitors and partners.
 *
 *   - VOLUME: posts collected per day (last 7 days) and per week (last 4
 *     weeks), split competitors / partners and LinkedIn / X. "Collected" is
 *     when the extension brought the post in (created_at), so a broken
 *     collector shows up as a zero day.
 *   - CONTENT TYPE: what the posts published in the last 7 days are about
 *     (rule-based topics, cheap and transparent), their format, the top
 *     hashtags and words, and the posts that got the most engagement.
 *   - COMPANY BY COMPANY: who is active, who went silent, and which of our
 *     companies each one is watched for (Competitor Watch links).
 */
import prisma from "@/lib/db";
import { etDayKey, etDayShort, etMidnight } from "../et-days";
import { banner, esc, etKeyOf, fmt, kpis, page, pill, section, shortDay, SITE, table, TD, TDR, TH, THR, type Level } from "./shell";

/** Generic topics — fits any industry (the VALOS-specific set lives in lib/competitors/analyze.ts). */
export const TOPICS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "product", label: "Product & launches", re: /\b(launch\w*|new feature|introduc\w+|releas\w+|now available|product|solution|update|version|unveil\w*|roll(?:ing)? out)\b/i },
  { key: "events", label: "Events & webinars", re: /\b(event|conference|webinar|summit|booth|join us|register|live|panel|speaking|keynote|expo|trade ?show|meet us|see you)\b/i },
  { key: "thought", label: "Thought leadership & tips", re: /\b(insight|trend|future of|how to|tips?|lesson|why|report|study|research|guide|blog|article|whitepaper|e-?book|podcast|opinion|survey|data shows)\b/i },
  { key: "customer", label: "Customer stories", re: /\b(customer|client|case study|success story|testimonial|helped|trusted by|use case)\b/i },
  { key: "partner", label: "Partnerships & deals", re: /\b(partner\w*|collaborat\w+|acqui\w+|agreement|signed|distribut\w+|alliance|joint|teaming)\b/i },
  { key: "news", label: "Company news & awards", re: /\b(award\w*|recogni\w+|named|ranked|milestone|announc\w+|press|funding|raised|series [a-e]|expan\w+|new office|appoint\w+|ceo)\b/i },
  { key: "hiring", label: "Hiring & culture", re: /\b(hiring|join our team|careers?|job|recruit\w*|meet the team|culture|welcome|anniversary|intern\w*|employee)\b/i },
  { key: "promo", label: "Promotions & offers", re: /\b(offer|discount|sale|promo\w*|free trial|book a demo|demo|deal|limited time|% off|black friday|pricing)\b/i },
];

const STOP = new Set(
  ("the and for with that this from your our you are was were will have has had not but all can more about into their there they them what when where which who how its it's also just than then out over new one two get got make made like see now via per any each other some such only very most much many well been being would could should may might must here every across within while today week year years team teams day days time help helps world great work working way ways business businesses company companies people learn read join us we i a an to of in on at by is be as or if so do does did no yes up down off").split(/\s+/),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\p{L}\p{N}_]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

function hashtagsOf(text: string, col: string | null): string[] {
  const out = new Set<string>();
  if (col) {
    let tags: string[] = [];
    try {
      const v = JSON.parse(col);
      if (Array.isArray(v)) tags = v.map(String);
    } catch {
      tags = col.split(/[,\s#]+/);
    }
    for (const t of tags) {
      const c = t.trim().replace(/^#/, "").toLowerCase();
      if (c.length >= 2 && /\p{L}/u.test(c)) out.add(c);
    }
  }
  for (const m of text.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) if (/\p{L}/u.test(m[1])) out.add(m[1].toLowerCase());
  return Array.from(out);
}

function top(map: Map<string, number>, n: number, min = 2) {
  return Array.from(map.entries())
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));
}

type Kind = "COMPETITION" | "PARTNER";

export type CompanyRow = {
  id: string;
  name: string;
  kind: Kind;
  watchedFor: string[];
  collectedWeek: number;
  collectedPrevWeek: number;
  publishedWeek: number;
  lastPostKey: string | null;
  mainTopic: string | null;
  engagementWeek: number;
};

export type CompetitiveReport = {
  dayKey: string;
  dayShort: string;
  companies: { competitors: number; partners: number };
  daily: Array<{ key: string; competitors: number; partners: number; linkedin: number; x: number; total: number }>;
  weekly: Array<{ label: string; competitors: number; partners: number; total: number }>;
  week: {
    published: number;
    topics: Array<{ label: string; count: number; share: number }>;
    withMedia: number;
    withLink: number;
    textOnly: number;
    hashtags: Array<{ term: string; count: number }>;
    keywords: Array<{ term: string; count: number }>;
    topPosts: Array<{ company: string; kind: Kind; date: string; text: string; engagement: number; url: string | null; platform: string }>;
  };
  rows: CompanyRow[];
  silent: CompanyRow[];
  level: Level;
};

export async function buildCompetitiveReport(orgId: string, now = new Date()): Promise<CompetitiveReport> {
  const clients = await prisma.client.findMany({
    where: { organizationId: orgId, archivedAt: null, status: { not: "ARCHIVED" }, clientType: { in: ["COMPETITION", "PARTNER"] } },
    select: { id: true, name: true, clientType: true },
    orderBy: { name: "asc" },
  });
  const ids = clients.map((c) => c.id);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const from28 = etMidnight(28, now);
  const today0 = etMidnight(0, now);
  const week0 = etMidnight(7, now);
  const week1 = etMidnight(14, now);

  const [posts, links, allClients, lastPosts] = await Promise.all([
    ids.length
      ? prisma.socialPost.findMany({
          where: { clientId: { in: ids }, OR: [{ createdAt: { gte: from28, lt: today0 } }, { publishedAtUtc: { gte: week0, lt: today0 } }] },
          select: {
            clientId: true, platform: true, createdAt: true, publishedAtUtc: true, publishedDateLocal: true,
            postTextSnippet: true, hashtags: true, hasMedia: true, likeCount: true, commentCount: true, shareCount: true, postUrl: true,
          },
          take: 8000,
        })
      : Promise.resolve([]),
    prisma.orgSetting.findMany({ where: { organizationId: orgId, key: { startsWith: "competitors:" } }, select: { key: true, value: true } }),
    prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    ids.length
      ? prisma.$queryRaw<Array<{ clientId: string; publishedDateLocal: string }>>`
          SELECT "clientId", MAX("publishedDateLocal") AS "publishedDateLocal"
          FROM social_posts WHERE "clientId" = ANY(${ids}) GROUP BY "clientId"`
      : Promise.resolve([] as Array<{ clientId: string; publishedDateLocal: string }>),
  ]);

  // Which of our companies each competitor is watched for.
  const nameOf = new Map(allClients.map((c) => [c.id, c.name]));
  const watchedFor = new Map<string, string[]>();
  for (const l of links) {
    const owner = nameOf.get(l.key.slice("competitors:".length));
    if (!owner) continue;
    try {
      const v = JSON.parse(l.value);
      if (Array.isArray(v)) for (const id of v) if (typeof id === "string") watchedFor.set(id, [...(watchedFor.get(id) || []), owner]);
    } catch {
      /* ignore a malformed link list */
    }
  }

  const kindOf = (id: string): Kind => (byId.get(id)?.clientType === "PARTNER" ? "PARTNER" : "COMPETITION");
  const collected = posts.filter((p) => p.createdAt >= from28 && p.createdAt < today0);

  // Daily (last 7 ET days) and weekly (last 4 weeks) collection volume.
  const keys = [7, 6, 5, 4, 3, 2, 1].map((d) => etDayKey(d, now));
  const daily = keys.map((key) => {
    const onDay = collected.filter((p) => etKeyOf(p.createdAt) === key);
    return {
      key,
      competitors: onDay.filter((p) => kindOf(p.clientId) === "COMPETITION").length,
      partners: onDay.filter((p) => kindOf(p.clientId) === "PARTNER").length,
      linkedin: onDay.filter((p) => p.platform === "LINKEDIN").length,
      x: onDay.filter((p) => p.platform === "TWITTER").length,
      total: onDay.length,
    };
  });
  const weekly = [0, 1, 2, 3].map((w) => {
    const a = etMidnight(7 * w + 7, now);
    const b = etMidnight(7 * w, now);
    const inW = collected.filter((p) => p.createdAt >= a && p.createdAt < b);
    const label = `${shortDay(etKeyOf(a))} – ${shortDay(etKeyOf(new Date(b.getTime() - 3600000)))}`;
    return {
      label: w === 0 ? `This week (${label})` : label,
      competitors: inW.filter((p) => kindOf(p.clientId) === "COMPETITION").length,
      partners: inW.filter((p) => kindOf(p.clientId) === "PARTNER").length,
      total: inW.length,
    };
  });

  // Content type — posts PUBLISHED in the last 7 days.
  const pub = posts.filter((p) => p.publishedAtUtc >= week0 && p.publishedAtUtc < today0);
  const topicCount = new Map<string, number>();
  const tagCount = new Map<string, number>();
  const wordCount = new Map<string, number>();
  const topicBy = new Map<string, Map<string, number>>();
  let withMedia = 0;
  let withLink = 0;
  let textOnly = 0;
  for (const p of pub) {
    const text = p.postTextSnippet || "";
    const hits = TOPICS.filter((t) => t.re.test(text)).map((t) => t.label);
    const labels = hits.length ? hits : ["Other"];
    for (const l of labels) {
      topicCount.set(l, (topicCount.get(l) || 0) + 1);
      const m = topicBy.get(p.clientId) || new Map<string, number>();
      m.set(l, (m.get(l) || 0) + 1);
      topicBy.set(p.clientId, m);
    }
    if (p.hasMedia) withMedia++;
    if (/https?:\/\//.test(text)) withLink++;
    if (!p.hasMedia && !/https?:\/\//.test(text)) textOnly++;
    for (const h of hashtagsOf(text, p.hashtags)) tagCount.set(h, (tagCount.get(h) || 0) + 1);
    for (const w of new Set(words(text))) wordCount.set(w, (wordCount.get(w) || 0) + 1);
  }
  const eng = (p: (typeof posts)[number]) => p.likeCount + p.commentCount + p.shareCount;
  const topics = Array.from(topicCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, share: pub.length ? Math.round((count / pub.length) * 100) : 0 }));
  const topPosts = [...pub]
    .sort((a, b) => eng(b) - eng(a))
    .slice(0, 5)
    .map((p) => ({
      company: byId.get(p.clientId)?.name || "?",
      kind: kindOf(p.clientId),
      date: p.publishedDateLocal,
      text: (p.postTextSnippet || "").slice(0, 220),
      engagement: eng(p),
      url: p.postUrl,
      platform: p.platform === "TWITTER" ? "X" : "LinkedIn",
    }));

  const lastBy = new Map(lastPosts.map((p) => [p.clientId, p.publishedDateLocal]));
  const rows: CompanyRow[] = clients.map((c) => {
    const mine = collected.filter((p) => p.clientId === c.id);
    const t = topicBy.get(c.id);
    const main = t ? Array.from(t.entries()).sort((a, b) => b[1] - a[1])[0][0] : null;
    const pubMine = pub.filter((p) => p.clientId === c.id);
    return {
      id: c.id,
      name: c.name,
      kind: kindOf(c.id),
      watchedFor: watchedFor.get(c.id) || [],
      collectedWeek: mine.filter((p) => p.createdAt >= week0).length,
      collectedPrevWeek: mine.filter((p) => p.createdAt >= week1 && p.createdAt < week0).length,
      publishedWeek: pubMine.length,
      lastPostKey: lastBy.get(c.id) ?? null,
      mainTopic: main,
      engagementWeek: pubMine.reduce((s, p) => s + eng(p), 0),
    };
  });
  rows.sort((a, b) => b.publishedWeek - a.publishedWeek || b.collectedWeek - a.collectedWeek || a.name.localeCompare(b.name));
  const silent = rows.filter((r) => r.collectedWeek === 0 && r.collectedPrevWeek === 0);

  const y = daily[daily.length - 1];
  const thisW = weekly[0].total;
  const prevW = weekly[1].total;
  const level: Level = ids.length && y.total === 0 && thisW === 0 ? "critical" : prevW > 0 && thisW < prevW / 2 ? "warn" : y.total === 0 ? "warn" : "ok";

  return {
    dayKey: keys[keys.length - 1],
    dayShort: etDayShort(1, now),
    companies: { competitors: clients.filter((c) => c.clientType === "COMPETITION").length, partners: clients.filter((c) => c.clientType === "PARTNER").length },
    daily,
    weekly,
    week: {
      published: pub.length,
      topics,
      withMedia,
      withLink,
      textOnly,
      hashtags: top(tagCount, 10),
      keywords: top(wordCount, 15),
      topPosts,
    },
    rows,
    silent,
    level,
  };
}

function bar(value: number, max: number, color: string): string {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<div style="background:#f3f4f6;border-radius:3px;height:10px;width:100%;"><div style="background:${color};height:10px;border-radius:3px;width:${w}%;"></div></div>`;
}

function chips(items: Array<{ term: string; count: number }>, prefix = ""): string {
  if (!items.length) return `<span style="color:#9ca3af;font-size:13px;">Not enough posts yet.</span>`;
  return items
    .map((k) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;border-radius:999px;background:#f3f4f6;font-size:12px;">${prefix}${esc(k.term)} <b style="color:#6b7280;">${k.count}</b></span>`)
    .join("");
}

export function renderCompetitive(r: CompetitiveReport): string {
  const y = r.daily[r.daily.length - 1];
  const w0 = r.weekly[0];
  const w1 = r.weekly[1];
  const delta = w1.total ? Math.round(((w0.total - w1.total) / w1.total) * 100) : null;
  const head = banner(
    r.level,
    r.level === "critical"
      ? `Nothing collected from competitors or partners this week`
      : `${y.total} posts collected on ${r.dayShort} · ${w0.total} this week`,
    `${r.companies.competitors} competitors and ${r.companies.partners} partners tracked.` +
      (delta !== null ? ` This week is ${delta >= 0 ? "up" : "down"} <b>${Math.abs(delta)}%</b> on last week (${w1.total}).` : "") +
      (r.silent.length ? ` <b>${r.silent.length}</b> ${r.silent.length === 1 ? "company has" : "companies have"} had nothing collected for 2 weeks.` : ""),
  );

  const maxDay = Math.max(1, ...r.daily.map((d) => d.total));
  const dailyTable = table(
    `<tr><th ${TH}>Day</th><th ${THR}>Competitors</th><th ${THR}>Partners</th><th ${THR}>LinkedIn</th><th ${THR}>X</th><th ${THR}>Total</th><th ${TH} width="30%"></th></tr>`,
    r.daily
      .map(
        (d) => `<tr><td ${TD}>${shortDay(d.key)}</td><td ${TDR}>${d.competitors}</td><td ${TDR}>${d.partners}</td><td ${TDR}>${d.linkedin}</td><td ${TDR}>${d.x}</td>
        <td ${TDR}><b style="color:${d.total ? "#111" : "#b91c1c"};">${d.total}</b></td><td ${TD}>${bar(d.total, maxDay, "#FE1B04")}</td></tr>`,
      )
      .join(""),
  );
  const maxW = Math.max(1, ...r.weekly.map((w) => w.total));
  const weeklyTable = table(
    `<tr><th ${TH}>Week</th><th ${THR}>Competitors</th><th ${THR}>Partners</th><th ${THR}>Total</th><th ${TH} width="30%"></th></tr>`,
    r.weekly
      .map(
        (w, i) => `<tr><td ${TD}>${i === 0 ? `<b>${esc(w.label)}</b>` : esc(w.label)}</td><td ${TDR}>${w.competitors}</td><td ${TDR}>${w.partners}</td>
        <td ${TDR}><b>${w.total}</b></td><td ${TD}>${bar(w.total, maxW, "#111")}</td></tr>`,
      )
      .join(""),
  );

  const wk = r.week;
  const maxTopic = Math.max(1, ...wk.topics.map((t) => t.count));
  const topicTable = wk.topics.length
    ? table(
        `<tr><th ${TH}>Topic</th><th ${THR}>Posts</th><th ${THR}>Share</th><th ${TH} width="35%"></th></tr>`,
        wk.topics
          .map((t) => `<tr><td ${TD}>${esc(t.label)}</td><td ${TDR}>${t.count}</td><td ${TDR}>${t.share}%</td><td ${TD}>${bar(t.count, maxTopic, "#2563eb")}</td></tr>`)
          .join(""),
      ) +
      `<div style="font-size:12px;color:#6b7280;margin-top:8px;">Format: <b>${wk.withMedia}</b> with a picture or video · <b>${wk.withLink}</b> with a link · <b>${wk.textOnly}</b> text only. A post can match several topics.</div>`
    : `<span style="color:#9ca3af;font-size:13px;">No competitor or partner post was published in the last 7 days.</span>`;

  const topPosts = wk.topPosts.length
    ? wk.topPosts
        .map(
          (p) => `<div style="padding:10px 0;border-bottom:1px solid #f1f1f1;">
        <div style="font-size:12px;color:#6b7280;"><b style="color:#111;">${esc(p.company)}</b> · ${p.kind === "PARTNER" ? "Partner" : "Competitor"} · ${esc(p.platform)} · ${esc(p.date)} · <b>${fmt(p.engagement)}</b> engagements</div>
        <div style="font-size:13px;margin-top:4px;line-height:1.45;">${esc(p.text)}${p.text.length >= 220 ? "…" : ""}</div>
        ${p.url ? `<a href="${esc(p.url)}" style="font-size:12px;color:#FE1B04;">Open the post</a>` : ""}
      </div>`,
        )
        .join("")
    : `<span style="color:#9ca3af;font-size:13px;">No posts this week.</span>`;

  const companyTable = table(
    `<tr><th ${TH}>Company</th><th ${THR}>Published<br>this week</th><th ${THR}>Collected<br>this week</th><th ${THR}>Collected<br>last week</th><th ${TH}>Main topic</th><th ${TH}>Last post</th></tr>`,
    r.rows
      .map(
        (c) => `<tr>
      <td ${TD}><a href="${SITE}/clients/${c.id}" style="color:#111;font-weight:700;text-decoration:none;">${esc(c.name)}</a>
        <div style="font-size:11px;color:#9ca3af;">${c.kind === "PARTNER" ? "Partner" : "Competitor"}${c.watchedFor.length ? ` of ${esc(c.watchedFor.join(", "))}` : ""}</div></td>
      <td ${TDR}><b>${c.publishedWeek}</b></td>
      <td ${TDR}>${c.collectedWeek}</td>
      <td ${TDR}>${c.collectedPrevWeek}</td>
      <td ${TD}>${c.mainTopic ? esc(c.mainTopic) : `<span style="color:#9ca3af;">—</span>`}</td>
      <td ${TD}>${c.lastPostKey ? esc(c.lastPostKey) : `<span style="color:#9ca3af;">never</span>`}${c.collectedWeek === 0 && c.collectedPrevWeek === 0 ? ` ${pill("silent 2 wks", "warn")}` : ""}</td>
    </tr>`,
      )
      .join(""),
  );

  const body =
    head +
    kpis([
      { label: `Collected ${shortDay(y.key)}`, value: String(y.total), level: y.total ? "ok" : "critical" },
      { label: "Collected this week", value: String(w0.total), hint: `last week ${w1.total}` },
      { label: "Published this week", value: String(wk.published), hint: "by competitors & partners" },
      { label: "Silent 2 weeks", value: String(r.silent.length), level: r.silent.length ? "warn" : "ok" },
    ]) +
    section("Collected every day — last 7 days", dailyTable, "When the Chrome extension brought the posts in.") +
    section("Collected every week — last 4 weeks", weeklyTable) +
    section("What they post about — this week", topicTable, `${wk.published} posts published by competitors and partners in the last 7 days.`) +
    section("Top hashtags", chips(wk.hashtags, "#")) +
    section("Most used words", chips(wk.keywords)) +
    section("Posts that got the most engagement", topPosts) +
    section("Company by company", companyTable);

  return page({
    kind: "competitive",
    title: "Social Competitive Report",
    subtitle: `Competitors & partners — ${r.dayShort}, the last 7 days and the last 4 weeks`,
    body,
    cta: { href: `${SITE}/clients`, label: "Open the companies" },
  });
}

export function competitiveSubject(r: CompetitiveReport): string {
  const y = r.daily[r.daily.length - 1];
  const base = `Social Competitive Report — ${r.dayShort}`;
  if (r.level === "critical") return `⛔ ${base} — nothing collected from competitors or partners`;
  const top = r.week.topics.find((t) => t.label !== "Other");
  return `${base} — ${y.total} collected yesterday, ${r.weekly[0].total} this week${top ? ` · top topic: ${top.label}` : ""}`;
}
