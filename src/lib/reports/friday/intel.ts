/**
 * Friday client reports (v4.78.0) — the Intelligence part: insights and actions
 * for ONE client, written by Cloudflare Workers AI (Olivier's 2026-10-04 rule:
 * no Claude / OpenAI) from the numbers of the Company + Competitive reports and
 * the week's posts. Cached per client per report day; rule-based when the AI
 * is unavailable, so the e-mail always goes out.
 */
import rawDb from "@/lib/db-raw";
import { getAISettings, runChat } from "@/lib/content/provider";
import { engagementOf, trend, type FPost } from "./analyze";
import type { FridayData } from "./data";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CACHE = "friday_intel:v1:";

export type Pillar = "Promote" | "Network" | "Engage";
export type FridayIntel = {
  headline: string;
  insights: Array<{ title: string; detail: string; basedOn: string }>;
  actions: Array<{ action: string; why: string; basedOn: string; pillar: Pillar; priority: "high" | "medium" | "low"; url: string | null }>;
  postIdeas: Array<{ hook: string; angle: string; basedOn: string }>;
  watch: Array<{ company: string; signal: string }>;
};
export type IntelResult = { intel: FridayIntel; ai: boolean; model: string | null; note: string | null };

type Sample = { id: number; company: string; role: string; platform: string; date: string; engagement: number; text: string; url: string | null };

function samplesOf(d: FridayData): Sample[] {
  const own = d.weekPosts.filter((p) => p.role === "self").slice(0, 6);
  const comp = d.weekPosts.filter((p) => p.role !== "self").slice(0, 10);
  return [...own, ...comp].map((p: FPost, i) => ({
    id: i + 1, company: p.company, role: p.role === "self" ? "client" : "competitor", platform: p.platform,
    date: p.date, engagement: engagementOf(p), text: p.text.slice(0, 420), url: p.url,
  }));
}

const SYSTEM = `You are the social-media intelligence analyst of Gershon Consulting, a B2B agency that runs LinkedIn and X campaigns for companies entering or growing in the US market.
You receive ONE client company ("client", with what it does in "about"), statistics about its own LinkedIn/X posts this week vs last week, the same statistics for the competitors linked to it, keyword gaps, and the week's most-engaged posts (each with an id).
Write the client's weekly intelligence: what the collected content tells us, and what Gershon should do for this client next week.
Rules:
- Use ONLY the data given. Never invent numbers, events or facts. If there is little data, say so and keep the lists short.
- Every insight and action cites the data it comes from in "basedOn": numbers from the stats or post ids like "#3" ("<Company> — <what they posted> (#id)").
- Actions are concrete and doable next week by Gershon's content team: a post to write (subject + angle), a comment to leave on a named post, a format to test, a topic to answer. No generic advice ("post more", "be consistent", "research the market").
- "pillar": Promote = the client's own posts, Network = connections/partners/events, Engage = comments and reactions on others' posts.
- "watch": competitor moves worth following (named company + the signal).
- Write in English for a US business reader. Short sentences.
Answer with ONE JSON object only, no prose around it:
{"headline": string, "insights": [{"title": string, "detail": string, "basedOn": string}] (3-5),
 "actions": [{"action": string, "why": string, "basedOn": string, "pillar": "Promote"|"Network"|"Engage", "priority": "high"|"medium"|"low", "postId": number|null}] (3-6),
 "postIdeas": [{"hook": string, "angle": string, "basedOn": string}] (2-3),
 "watch": [{"company": string, "signal": string}] (0-4)}`;

const s = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const a = (v: unknown) => (Array.isArray(v) ? v : []);

export function parseFridayIntel(text: string, samples: Array<{ id: number; url: string | null }>): FridayIntel | null {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(i, j + 1));
  } catch {
    return null;
  }
  const urlOf = new Map(samples.map((x) => [x.id, x.url]));
  const pillar = (v: unknown): Pillar => (v === "Network" || v === "Engage" ? v : "Promote");
  const prio = (v: unknown) => (v === "high" || v === "low" ? v : "medium") as "high" | "medium" | "low";
  const intel: FridayIntel = {
    headline: s(raw.headline, 240),
    insights: a(raw.insights).map((x: any) => ({ title: s(x?.title, 120), detail: s(x?.detail, 500), basedOn: s(x?.basedOn, 300) })).filter((x) => x.title || x.detail).slice(0, 5),
    actions: a(raw.actions)
      .map((x: any) => {
        const id = typeof x?.postId === "number" ? x.postId : Number((s(x?.basedOn).match(/#(\d+)/) || [])[1]) || null;
        return { action: s(x?.action, 300), why: s(x?.why, 300), basedOn: s(x?.basedOn, 300), pillar: pillar(x?.pillar), priority: prio(x?.priority), url: id ? urlOf.get(id) || null : null };
      })
      .filter((x) => x.action)
      .slice(0, 6),
    postIdeas: a(raw.postIdeas).map((x: any) => ({ hook: s(x?.hook, 200), angle: s(x?.angle, 300), basedOn: s(x?.basedOn, 300) })).filter((x) => x.hook).slice(0, 3),
    watch: a(raw.watch).map((x: any) => ({ company: s(x?.company, 80), signal: s(x?.signal, 300) })).filter((x) => x.company && x.signal).slice(0, 4),
  };
  return intel.headline || intel.insights.length || intel.actions.length ? intel : null;
}

/** Rule-based stand-in: same shape, built only from the numbers. */
export function fallbackFridayIntel(d: FridayData): FridayIntel {
  const { self, competitors, comparison: c } = d;
  const insights: FridayIntel["insights"] = [];
  const actions: FridayIntel["actions"] = [];
  insights.push({
    title: self.postsWeek ? `${self.name} published ${self.postsWeek} post${self.postsWeek > 1 ? "s" : ""}` : `${self.name} published nothing this week`,
    detail: `Posts ${trend(self.postsWeek, self.postsPrev)} vs the week before, engagement ${trend(self.engagementWeek, self.engagementPrev)} (${self.engagementWeek} interactions).`,
    basedOn: `${self.postsWeek} posts this week, ${self.postsPrev} last week`,
  });
  if (competitors.length) {
    insights.push({
      title: `Rank #${c.rankByEngagement} of ${competitors.length + 1} on engagement`,
      detail: `Share of voice: ${c.shareOfVoice.find((x) => x.role === "self")?.postShare ?? 0}% of posts, ${c.shareOfVoice.find((x) => x.role === "self")?.engagementShare ?? 0}% of engagement among the tracked competitors.`,
      basedOn: `${competitors.length} competitors linked in Competitor Watch`,
    });
    const leader = competitors.find((x) => x.postsWeek > 0);
    if (leader?.mainTopic) {
      actions.push({ action: `Publish a ${self.name} post on "${leader.mainTopic}" with a clear point of view`, why: `${leader.name}'s main topic this week`, basedOn: `${leader.name} — ${leader.postsWeek} posts, ${leader.engagementWeek} interactions`, pillar: "Promote", priority: "medium", url: leader.topPosts[0]?.url || null });
    }
    const best = d.weekPosts.find((p) => p.role === "competitor");
    if (best?.url) actions.push({ action: `Comment from ${self.name}'s page on ${best.company}'s most engaged post`, why: "Visibility in the audience that is most active this week", basedOn: `${best.company} — ${best.text.slice(0, 80)}…`, pillar: "Engage", priority: "low", url: best.url });
    if (c.gaps.length) insights.push({ title: "Words competitors use that the client does not", detail: c.gaps.slice(0, 6).map((g) => g.term).join(", "), basedOn: "Keyword comparison, this week" });
  }
  if (!self.postsWeek) actions.unshift({ action: `Schedule at least 2 posts for ${self.name} next week`, why: "No post was collected this week", basedOn: "0 posts collected", pillar: "Promote", priority: "high", url: null });
  else if (self.topPosts[0]) actions.push({ action: `Re-use the angle of ${self.name}'s best post this week in a new format`, why: `${engagementOf(self.topPosts[0])} interactions`, basedOn: self.topPosts[0].text.slice(0, 100), pillar: "Promote", priority: "medium", url: self.topPosts[0].url });
  return { headline: insights[0].title, insights, actions, postIdeas: [], watch: competitors.filter((x) => x.postsWeek > self.postsWeek).slice(0, 3).map((x) => ({ company: x.name, signal: `${x.postsWeek} posts this week (${trend(x.postsWeek, x.postsPrev)})` })) };
}

export async function buildFridayIntel(d: FridayData, opts: { refresh?: boolean } = {}): Promise<IntelResult> {
  const key = `${CACHE}${d.client.id}:${d.dayKey}`;
  if (!opts.refresh) {
    const row = await rawDb.setting.findUnique({ where: { key } }).catch(() => null);
    if (row?.value) {
      try {
        const v = JSON.parse(row.value) as { intel: FridayIntel; model: string };
        return { intel: v.intel, ai: true, model: v.model, note: null };
      } catch {
        /* rebuild */
      }
    }
  }
  const samples = samplesOf(d);
  if (!samples.length) return { intel: fallbackFridayIntel(d), ai: false, model: null, note: "No post from the client or its competitors this week — Intelligence had nothing to analyse." };
  try {
    const settings = await getAISettings();
    if (!settings.available) throw new Error("Cloudflare Workers AI is not available on this deployment");
    const stat = (x: FridayData["self"]) => ({
      name: x.name, postsThisWeek: x.postsWeek, postsLastWeek: x.postsPrev, linkedin: x.linkedinWeek, x: x.xWeek,
      engagementThisWeek: x.engagementWeek, engagementLastWeek: x.engagementPrev, avgEngagementPerPost: x.avgEngagement,
      withMediaPct: x.mediaShare, activeDays: x.activeDays, topics: x.topics, hashtags: x.hashtags, keywords: x.keywords, lastPost: x.lastPostKey,
    });
    const payload = {
      week: d.weekLabel,
      client: { ...stat(d.self), about: d.client.about || undefined },
      competitors: d.competitors.map(stat),
      shareOfVoice: d.comparison.shareOfVoice,
      keywordGaps: d.comparison.gaps,
      ownedKeywords: d.comparison.owned,
      topicMix: d.comparison.topicMix,
      posts: samples.map(({ url: _u, ...rest }) => rest),
    };
    const out = await runChat({ ...settings, model: MODEL }, SYSTEM, JSON.stringify(payload), 3000);
    const intel = parseFridayIntel(out.text, samples);
    if (!intel) throw new Error("Intelligence answered in an unreadable format");
    const value = JSON.stringify({ intel, model: out.model });
    await rawDb.setting.upsert({ where: { key }, update: { value }, create: { key, value } }).catch(() => undefined);
    return { intel, ai: true, model: out.model, note: null };
  } catch (e) {
    return { intel: fallbackFridayIntel(d), ai: false, model: null, note: `Intelligence could not run (${e instanceof Error ? e.message.slice(0, 160) : "error"}) — rule-based insights below.` };
  }
}
