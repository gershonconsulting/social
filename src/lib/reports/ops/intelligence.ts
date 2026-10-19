/**
 * Report 5 — INTELLIGENCE (v4.50.0): insights and ACTIONS from what
 * competitors and partners posted this week. Sent to sales@ (Olivier,
 * 2026-10-16: "for the competition and partners content I need insights. Use
 * intelligence to bring actions related to what they post" — "use sales@").
 *
 * Cloudflare Workers AI only (Olivier's 2026-10-04 decision) via the shared
 * provider layer. The model gets the pre-computed numbers from the
 * Competitive report plus the week's most-engaged posts — never a raw dump —
 * and our own campaign / internal companies, so every action names the
 * company it is for. The answer is cached per ET day, so the browser preview
 * and the email never pay for two calls. If the AI is unavailable the email
 * still goes out with rule-based actions, clearly labelled.
 */
import prisma from "@/lib/db";
import { getAISettings, runChat } from "@/lib/content/provider";
import { PUBLISHING_CLIENT_TYPES } from "@/lib/publishing";
import { etMidnight } from "../et-days";
import { buildCompetitiveReport, type CompetitiveReport } from "./competitive";
import { banner, esc, fmt, kpis, page, pill, section, SITE, type Level } from "./shell";

export const INTEL_TO = "sales@gershonconsulting.com";
const CACHE_PREFIX = "ops_intel:v3:";
const INTEL_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

type Priority = "high" | "medium" | "low";

export type Intel = {
  headline: string;
  insights: Array<{ title: string; detail: string; companies: string[] }>;
  actions: Array<{ action: string; forCompany: string; why: string; basedOn: string; priority: Priority }>;
  engage: Array<{ company: string; post: string; how: string; url: string | null }>;
  postIdeas: Array<{ forCompany: string; hook: string; angle: string }>;
  watch: Array<{ company: string; signal: string }>;
};

export type IntelligenceReport = {
  dayKey: string;
  dayShort: string;
  competitive: CompetitiveReport;
  ours: Array<{ name: string; type: string; industry: string | null }>;
  intel: Intel;
  source: { ai: boolean; model: string | null; note: string | null };
  level: Level;
};

/**
 * What our companies do, for the AI. The Client row's industry wins when it is
 * filled in; otherwise this list (from the Campaign Content Knowledge Base,
 * Aug 2026). A company missing from both is sent without a description and the
 * model is told not to guess what it does.
 */
const ABOUT: Array<{ re: RegExp; about: string }> = [
  { re: /gershon/i, about: "US market-entry consulting for foreign (mostly French/European) B2B companies: LinkedIn outbound, lead generation, commercial representation in the US" },
  { re: /\bwallix\b/i, about: "Cybersecurity — privileged access management (PAM), identity and OT security; selling to US CISOs, IAM/PAM architects, MSSPs" },
  { re: /\bvalos\b/i, about: "Clinical data management and biometrics/biostatistics services for US biotech, specialty pharma and medtech" },
  { re: /urban factory/i, about: "IT accessories, docking stations and ergonomics, sold through the US IT reseller channel" },
  { re: /phi-?tech/i, about: "AI + RNA/genomics diagnostics for geneticists, molecular pathologists and pharma R&D" },
  { re: /enzymicals/i, about: "Biocatalysis / green-chemistry CDMO for US pharma process and development chemists" },
  { re: /flying secoya/i, about: "Sustainable (eco) production consultancy + SaaS for film and TV productions — carbon measurement and ESG reporting" },
  { re: /linalysis/i, about: "LinkedIn analytics SaaS (Gershon venture)" },
  { re: /american ?abroad/i, about: "AmericanAbroad.net — hub for Americans living abroad (expats): practical resources, local representatives and partner services" },
];

export function aboutOf(name: string, industry: string | null): string | null {
  const hit = ABOUT.find((a) => a.re.test(name));
  return hit?.about || industry || null;
}

type Sample = { id: number; company: string; kind: string; watchedFor: string[]; platform: string; date: string; engagement: number; text: string; url: string | null };

const SYSTEM = `You are the competitive-intelligence analyst of Gershon Consulting, a B2B firm that helps companies enter the US market through LinkedIn and X.
You receive (1) Gershon's own companies (campaign clients and internal brands), (2) statistics about what their competitors and partners posted on LinkedIn/X this week, and (3) the week's most-engaged competitor/partner posts, each with an id.
Your job: turn what competitors and partners post into concrete actions the Gershon sales and content team can take THIS WEEK.
Rules:
- Competitors and partners that are not linked to one of our companies ("watchedFor" empty) are part of Gershon Consulting's OWN market (organisations around foreign companies entering the US). Actions based on them are for "Gershon Consulting" unless the post is clearly about the field of another of our companies (use their "about").
- Never guess what one of our companies does: use only its "about". If it has no "about", do not give it an action.
- Only give actions to the companies in "ourCompanies". Most actions will be for Gershon Consulting — that is expected. Do not stretch an unrelated post into an action for another company.
- Rank by business value for Gershon: a partner event or program where Gershon can meet foreign companies entering the US, or a competitor move Gershon must answer, is high; a simple like/share is low.
- Every action names ONE of Gershon's own companies in "forCompany" (exact name from the list), or "Gershon Consulting" for agency-wide actions.
- "basedOn" cites the competitor/partner and what they posted (use the post ids like "#3").
- Competitors: find what works for them (topics, formats, events) and how our company should answer, counter-position or fill the gap.
- Partners: find chances to engage (comment, share, co-post, joint webinar, introductions) that help our company.
- Each action names the competitor/partner and the precise subject of their post, and says exactly what to do (post, comment, reach out to whom, propose what). No generic advice like "post more consistently" or "research the market".
- "basedOn" format: "<Company> — <what they posted> (#id)".
- "headline" is the single most useful finding of the week in one sentence with a name or a number in it — never a title like "Competitor analysis".
- If the data is thin, say so in the headline instead of inventing.
Answer ONLY with a JSON object, no prose, exactly this shape:
{
  "headline": string,
  "insights": [ { "title": string, "detail": string, "companies": string[] } ],
  "actions": [ { "action": string, "forCompany": string, "why": string, "basedOn": string, "priority": "high"|"medium"|"low" } ],
  "engage": [ { "postId": number, "how": string } ],   // "how" = the exact comment to post, 1-2 sentences, in English, from Gershon's or the named company's voice
  "postIdeas": [ { "forCompany": string, "hook": string, "angle": string } ],
  "watch": [ { "company": string, "signal": string } ]
}
Give 3-5 insights, 5-8 actions (highest priority first), up to 5 engage items, 3-5 post ideas, up to 4 watch items.`;

function str(v: unknown, max = 400): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function prio(v: unknown): Priority {
  return v === "high" || v === "low" ? v : "medium";
}

function parseIntel(text: string, samples: Sample[]): Intel | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  const byId = new Map(samples.map((s) => [s.id, s]));
  const intel: Intel = {
    headline: str(raw.headline, 240),
    insights: arr(raw.insights)
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ title: str(x.title, 120), detail: str(x.detail, 500), companies: arr(x.companies).map((c) => str(c, 80)).filter(Boolean) }))
      .filter((x) => x.title)
      .slice(0, 6),
    actions: arr(raw.actions)
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ action: str(x.action, 300), forCompany: str(x.forCompany, 80), why: str(x.why, 300), basedOn: str(x.basedOn, 200), priority: prio(x.priority) }))
      .filter((x) => x.action)
      .slice(0, 10),
    engage: arr(raw.engage)
      .map((x) => x as Record<string, unknown>)
      .map((x) => {
        const s = byId.get(Number(x.postId));
        return s ? { company: s.company, post: s.text.slice(0, 160), how: str(x.how, 300), url: s.url } : null;
      })
      .filter((x): x is Intel["engage"][number] => !!x && !!x.how)
      .slice(0, 5),
    postIdeas: arr(raw.postIdeas)
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ forCompany: str(x.forCompany, 80), hook: str(x.hook, 200), angle: str(x.angle, 300) }))
      .filter((x) => x.hook)
      .slice(0, 6),
    watch: arr(raw.watch)
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ company: str(x.company, 80), signal: str(x.signal, 300) }))
      .filter((x) => x.company && x.signal)
      .slice(0, 5),
  };
  const rank = { high: 0, medium: 1, low: 2 } as const;
  intel.actions.sort((p, q) => rank[p.priority] - rank[q.priority]);
  return intel.headline || intel.actions.length ? intel : null;
}

/** Rule-based stand-in when the AI cannot be reached, so the email still carries actions. */
function fallbackIntel(r: CompetitiveReport, samples: Sample[]): Intel {
  const topTopic = r.week.topics.find((t) => t.label !== "Other");
  const actions: Intel["actions"] = [];
  for (const s of samples.slice(0, 3)) {
    const forCompany = s.watchedFor[0] || "Gershon Consulting";
    actions.push(
      s.kind === "PARTNER"
        ? { action: `Comment on and share ${s.company}'s post from ${s.date}`, forCompany, why: `It is the partner post with the most engagement this week (${s.engagement}).`, basedOn: `#${s.id} ${s.company}`, priority: "medium" }
        : { action: `Publish an answer to ${s.company}'s top post of the week, on the same subject, from our angle`, forCompany, why: `${s.engagement} engagements — the subject clearly works with this audience.`, basedOn: `#${s.id} ${s.company}`, priority: "high" },
    );
  }
  if (topTopic) actions.push({ action: `Plan at least one "${topTopic.label}" post this week`, forCompany: "Gershon Consulting", why: `${topTopic.share}% of competitor/partner posts this week were about it.`, basedOn: "topic mix", priority: "medium" });
  return {
    headline: topTopic ? `Competitors and partners focused on ${topTopic.label.toLowerCase()} this week` : "Not enough competitor or partner posts this week for insights",
    insights: [],
    actions,
    engage: samples.filter((s) => s.kind === "PARTNER").slice(0, 3).map((s) => ({ company: s.company, post: s.text.slice(0, 160), how: "Like, comment with a point of view, and share it to the client's page.", url: s.url })),
    postIdeas: [],
    watch: r.silent.slice(0, 4).map((c) => ({ company: c.name, signal: "Nothing collected for 2 weeks — check the page link or whether they stopped posting." })),
  };
}

async function readCache(dayKey: string): Promise<{ intel: Intel; model: string } | null> {
  const row = await prisma.setting.findUnique({ where: { key: CACHE_PREFIX + dayKey } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}
async function writeCache(dayKey: string, v: { intel: Intel; model: string }): Promise<void> {
  const value = JSON.stringify(v);
  await prisma.setting.upsert({ where: { key: CACHE_PREFIX + dayKey }, update: { value }, create: { key: CACHE_PREFIX + dayKey, value } });
}

export async function buildIntelligenceReport(orgId: string, opts: { refresh?: boolean } = {}, now = new Date()): Promise<IntelligenceReport> {
  const competitive = await buildCompetitiveReport(orgId, now);
  const ids = competitive.rows.map((c) => c.id);
  const meta = new Map(competitive.rows.map((c) => [c.id, c]));

  const [oursRows, posts] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: orgId, archivedAt: null, status: { not: "ARCHIVED" }, clientType: { in: PUBLISHING_CLIENT_TYPES } },
      select: { name: true, clientType: true, industry: true },
      orderBy: { name: "asc" },
    }),
    ids.length
      ? prisma.socialPost.findMany({
          where: { clientId: { in: ids }, publishedAtUtc: { gte: etMidnight(7, now), lt: etMidnight(0, now) } },
          select: { clientId: true, platform: true, publishedDateLocal: true, postTextSnippet: true, postTextFull: true, likeCount: true, commentCount: true, shareCount: true, postUrl: true },
          take: 600,
        })
      : Promise.resolve([]),
  ]);
  // Only companies a tracked competitor/partner is linked to (Competitor Watch)
  // can receive actions, plus Gershon Consulting itself, whose market the
  // unlinked ones belong to. Otherwise the model invents links (a travel post
  // turned into a biocatalysis action).
  const linked = new Set(competitive.rows.flatMap((c) => c.watchedFor.map((n) => n.trim().toLowerCase())));
  const ours = oursRows
    .filter((c) => /gershon/i.test(c.name) || linked.has(c.name.trim().toLowerCase()))
    .map((c) => ({ name: c.name.trim(), type: c.clientType === "INTERNAL" ? "internal brand" : "campaign client", industry: aboutOf(c.name, c.industry) }));
  if (!ours.some((o) => /gershon/i.test(o.name))) ours.unshift({ name: "Gershon Consulting", type: "internal brand", industry: aboutOf("Gershon Consulting", null) });

  const samples: Sample[] = posts
    .map((p) => ({ p, e: p.likeCount + p.commentCount + p.shareCount }))
    .sort((a, b) => b.e - a.e)
    .slice(0, 25)
    .map(({ p, e }, i) => {
      const m = meta.get(p.clientId);
      return {
        id: i + 1,
        company: m?.name || "?",
        kind: m?.kind || "COMPETITION",
        watchedFor: m?.watchedFor || [],
        platform: p.platform === "TWITTER" ? "X" : "LinkedIn",
        date: p.publishedDateLocal,
        engagement: e,
        text: (p.postTextFull || p.postTextSnippet || "").replace(/\s+/g, " ").slice(0, 400),
        url: p.postUrl,
      };
    });

  let intel: Intel | null = null;
  let model: string | null = null;
  let note: string | null = null;

  const cached = opts.refresh ? null : await readCache(competitive.dayKey);
  if (cached) {
    intel = cached.intel;
    model = cached.model;
  } else if (samples.length === 0) {
    note = "No competitor or partner post was published this week, so there is nothing for Intelligence to analyse.";
  } else {
    try {
      const settings = await getAISettings();
      if (!settings.available) throw new Error("Cloudflare Workers AI is not available on this deployment");
      const payload = {
        ourCompanies: ours.map((o) => ({ name: o.name, type: o.type, about: o.industry || undefined })),
        week: {
          collectedThisWeek: competitive.weekly[0].total,
          collectedLastWeek: competitive.weekly[1].total,
          publishedThisWeek: competitive.week.published,
          topicMix: competitive.week.topics,
          format: { withMedia: competitive.week.withMedia, withLink: competitive.week.withLink, textOnly: competitive.week.textOnly },
          topHashtags: competitive.week.hashtags,
          topWords: competitive.week.keywords,
        },
        competitorsAndPartners: competitive.rows.map((c) => ({
          name: c.name,
          role: c.kind === "PARTNER" ? "partner" : "competitor",
          watchedFor: c.watchedFor,
          publishedThisWeek: c.publishedWeek,
          mainTopic: c.mainTopic,
          engagementThisWeek: c.engagementWeek,
          lastPost: c.lastPostKey,
        })),
        topPosts: samples.map((s) => ({ id: s.id, company: s.company, role: s.kind === "PARTNER" ? "partner" : "competitor", watchedFor: s.watchedFor, platform: s.platform, date: s.date, engagement: s.engagement, text: s.text })),
      };
      // The 70B model reasons noticeably better on this task; runChat falls back down the chain if it is unavailable.
      const out = await runChat({ ...settings, model: INTEL_MODEL }, SYSTEM, JSON.stringify(payload), 3500);
      intel = parseIntel(out.text, samples);
      model = out.model;
      if (!intel) throw new Error("Intelligence answered in an unreadable format");
      try {
        await writeCache(competitive.dayKey, { intel, model });
      } catch {
        /* cache is an optimisation */
      }
    } catch (e) {
      note = `Intelligence could not run (${e instanceof Error ? e.message.slice(0, 160) : "error"}) — the actions below are rule-based.`;
      intel = null;
    }
  }

  const final = intel || fallbackIntel(competitive, samples);
  const level: Level = !intel ? "warn" : final.actions.some((a) => a.priority === "high") ? "critical" : "ok";
  return {
    dayKey: competitive.dayKey,
    dayShort: competitive.dayShort,
    competitive,
    ours,
    intel: final,
    source: { ai: !!intel, model, note },
    level,
  };
}

const PRIO_LEVEL: Record<Priority, Level> = { high: "critical", medium: "warn", low: "ok" };
const PRIO_LABEL: Record<Priority, string> = { high: "HIGH", medium: "MEDIUM", low: "LOW" };

export function renderIntelligence(r: IntelligenceReport): string {
  const i = r.intel;
  const c = r.competitive;
  const high = i.actions.filter((a) => a.priority === "high").length;

  const head = banner(
    r.source.ai ? (high ? "critical" : "ok") : "warn",
    i.headline || "This week's competitor and partner intelligence",
    `${i.actions.length} actions for our companies${high ? `, <b>${high} high priority</b>` : ""}. Based on ${c.week.published} posts published this week by ${c.companies.competitors} competitors and ${c.companies.partners} partners.` +
      (r.source.note ? `<br><span style="font-size:12px;">${esc(r.source.note)}</span>` : ""),
  );

  const actions = i.actions.length
    ? i.actions
        .map(
          (a, n) => `<div style="padding:12px 0;border-bottom:1px solid #f1f1f1;">
        <div style="font-size:12px;color:#6b7280;">${pill(PRIO_LABEL[a.priority], PRIO_LEVEL[a.priority])} &nbsp;<b style="color:#111;">For ${esc(a.forCompany || "Gershon Consulting")}</b></div>
        <div style="font-size:15px;font-weight:700;margin-top:6px;line-height:1.4;">${n + 1}. ${esc(a.action)}</div>
        ${a.why ? `<div style="font-size:13px;color:#374151;margin-top:4px;line-height:1.45;">${esc(a.why)}</div>` : ""}
        ${a.basedOn ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">Based on: ${esc(a.basedOn)}</div>` : ""}
      </div>`,
        )
        .join("")
    : `<span style="color:#9ca3af;font-size:13px;">No action this week.</span>`;

  const insights = i.insights.length
    ? i.insights
        .map(
          (x) => `<div style="padding:10px 0;border-bottom:1px solid #f1f1f1;">
        <div style="font-size:14px;font-weight:700;">${esc(x.title)}</div>
        <div style="font-size:13px;color:#374151;margin-top:3px;line-height:1.45;">${esc(x.detail)}</div>
        ${x.companies.length ? `<div style="font-size:12px;color:#9ca3af;margin-top:3px;">${esc(x.companies.join(" · "))}</div>` : ""}
      </div>`,
        )
        .join("")
    : "";

  const engage = i.engage.length
    ? i.engage
        .map(
          (e) => `<div style="padding:10px 0;border-bottom:1px solid #f1f1f1;">
        <div style="font-size:13px;"><b>${esc(e.company)}</b> — <span style="color:#6b7280;">“${esc(e.post)}${e.post.length >= 160 ? "…" : ""}”</span></div>
        <div style="font-size:13px;margin-top:4px;">→ ${esc(e.how)}</div>
        ${e.url ? `<a href="${esc(e.url)}" style="font-size:12px;color:#FE1B04;">Open the post</a>` : ""}
      </div>`,
        )
        .join("")
    : "";

  const ideas = i.postIdeas.length
    ? i.postIdeas
        .map(
          (p) => `<div style="padding:10px 0;border-bottom:1px solid #f1f1f1;">
        <div style="font-size:12px;color:#6b7280;">For <b style="color:#111;">${esc(p.forCompany)}</b></div>
        <div style="font-size:14px;font-weight:700;margin-top:3px;">“${esc(p.hook)}”</div>
        <div style="font-size:13px;color:#374151;margin-top:3px;">${esc(p.angle)}</div>
      </div>`,
        )
        .join("")
    : "";

  const watch = i.watch.length
    ? i.watch.map((w) => `<div style="padding:6px 0;font-size:13px;"><b>${esc(w.company)}</b> — ${esc(w.signal)}</div>`).join("")
    : "";

  const body =
    head +
    kpis([
      { label: "Actions", value: String(i.actions.length), hint: `${high} high priority`, level: high ? "critical" : "ok" },
      { label: "Posts analysed", value: fmt(c.week.published), hint: "published this week" },
      { label: "Competitors", value: String(c.companies.competitors) },
      { label: "Partners", value: String(c.companies.partners) },
    ]) +
    section("Actions for this week", actions) +
    (insights ? section("What they are doing", insights) : "") +
    (engage ? section("Partner & competitor posts to engage with", engage) : "") +
    (ideas ? section("Post ideas for our companies", ideas) : "") +
    (watch ? section("Keep an eye on", watch) : "") +
    `<div style="padding:12px 24px;font-size:11px;color:#9ca3af;border-bottom:1px solid #eee;">${r.source.ai ? `Written by Intelligence (Cloudflare Workers AI · ${esc(r.source.model || "")}) from the numbers in the Competitive report. Check before acting.` : "Rule-based actions — Intelligence was not available for this run."}</div>`;

  return page({
    kind: "intelligence",
    title: "Social Intelligence Report",
    subtitle: `Insights and actions from competitors & partners — week to ${r.dayShort}`,
    body,
    cta: { href: `${SITE}/api/report/ops?kind=competitive`, label: "See the full Competitive report" },
  });
}

export function intelligenceSubject(r: IntelligenceReport): string {
  const high = r.intel.actions.filter((a) => a.priority === "high").length;
  const base = `Social Intelligence Report — ${r.dayShort}`;
  return `${base} — ${r.intel.actions.length} actions${high ? ` (${high} high priority)` : ""}`;
}
