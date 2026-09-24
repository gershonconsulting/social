/**
 * Competitor Watch — the deterministic comparison layer.
 *
 * For a company and each of its tracked competitors, answers four questions
 * from the posts we already collect:
 *   WHO     — the company, its volume and engagement
 *   WHAT    — theme mix (rule-based, free) and top posts
 *   KEYWORDS— top words / two-word phrases and hashtags
 *   FREQUENCY — posts per week, active weeks, longest silence, best weekday
 *
 * Plain TypeScript, no model call, so it renders instantly and costs nothing.
 * The optional AI brief (see brief route) is fed these numbers.
 */

import { buildCorpus, type CorpusPost } from "@/lib/content/corpus";

const STOP = new Set(
  (
    "the a an and or but in on at to for of with by from is it its this that are was were be been being have has had do does did " +
    "will would could should may might shall can not no so if then than too very just about up out all also as we our you your they " +
    "their them my me i he she his her who what when where how which more most some any each every much many own other into over such " +
    "only new now way these those here there both between through during before after above below get got make made take like amp https " +
    "http www com one two even well back still us day let see go know join us re ll ve don isn it's we're we've you're here's lnkd " +
    "today week year years time team teams help helps helping work working great proud excited happy thank thanks please learn read " +
    "click link comments via meet look looking forward find out more info information register share sharing next latest first last " +
    "use using used need needs key role part across within without whether while why yet via around always never really many much " +
    "de la le les des et en du un une el los las y con per il di che al"
  ).split(/\s+/)
);

/** Rule-based themes — cheap, transparent, good enough to show a mix. */
export const THEMES: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "events", label: "Events & conferences", re: /\b(conference|booth|summit|congress|symposium|phuse|scdm|dia\b|jsm|iscb|cdisc interchange|bio\s?20|asco|scope|see you at|visit us|poster|presentation|speaking|panel)\b/i },
  { key: "webinar", label: "Webinars & content", re: /\b(webinar|whitepaper|white paper|e-?book|podcast|blog|article|guide|download|on-demand|episode|newsletter)\b/i },
  { key: "hiring", label: "Hiring & culture", re: /\b(hiring|we're hiring|join our team|career|careers|vacanc|job|recruit|meet the team|meet our|employee|culture|anniversary|welcome to the team|intern)\b/i },
  { key: "regulatory", label: "Regulatory / FDA", re: /\b(fda|ema|regulator|regulatory|guidance|submission|approval|ich|e9|inspection|mhra|pmda|hta|jca|nda|bla|ind)\b/i },
  { key: "ai", label: "AI & technology", re: /\b(ai|artificial intelligence|machine learning|genai|llm|agentic|automation|automated|platform|software|digital|r shiny|python|\br\b)\b/i },
  { key: "standards", label: "CDISC & data standards", re: /\b(cdisc|sdtm|adam|define\.?xml|dataset-json|tlf|tfl|data standards|controlled terminology)\b/i },
  { key: "methods", label: "Statistical methods", re: /\b(bayesian|adaptive|estimand|sample size|interim|dmc|dsmb|causal|multiplicity|survival|dose[- ]finding|missing data|imputation|modelling|modeling|simulation)\b/i },
  { key: "rwe", label: "RWE & HEOR", re: /\b(real[- ]world|rwe|rwd|heor|external control|synthetic control|observational|registry)\b/i },
  { key: "therapeutic", label: "Therapeutic areas", re: /\b(oncology|cancer|rare disease|gene therapy|cell therapy|cardio|neuro|vaccine|immunology|obesity|respiratory)\b/i },
  { key: "corporate", label: "Company news & awards", re: /\b(award|acquisition|acquire|partnership|partner with|announce|milestone|expan|new office|launch|ceo|appoint)\b/i },
];

export type Keyword = { term: string; count: number };

export type CompanyWatch = {
  id: string;
  name: string;
  isSelf: boolean;
  postCount: number;
  postsPerWeek: number;
  activeWeeks: number;
  weeksInWindow: number;
  lastPostDate: string | null;
  daysSinceLastPost: number | null;
  gapDays: number;
  bestWeekday: string | null;
  avgEngagement: number;
  medianEngagement: number;
  mediaRate: number;
  avgLength: number;
  hashtagRate: number;
  keywords: Keyword[];
  phrases: Keyword[];
  hashtags: Keyword[];
  themes: Array<{ key: string; label: string; count: number; share: number }>;
  topPosts: Array<{ date: string; text: string; engagement: number; url: string | null }>;
  platforms: Array<{ platform: string; count: number }>;
};

export type CompetitorWatchResult = {
  windowDays: number;
  self: CompanyWatch;
  competitors: CompanyWatch[];
  /** Keywords several competitors use that the company itself never uses. */
  gaps: Array<{ term: string; competitors: number; mentions: number }>;
  /** Keywords the company uses that no competitor uses — its owned ground. */
  owned: Keyword[];
  /** Theme share, company vs competitor average (percentage points). */
  themeComparison: Array<{ key: string; label: string; self: number; competitors: number }>;
  ranking: Array<{ id: string; name: string; postsPerWeek: number; avgEngagement: number; isSelf: boolean }>;
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/@[\p{L}\p{N}_]+/gu, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

function topN(map: Map<string, number>, n: number, min = 2): Keyword[] {
  return Array.from(map.entries())
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function summarize(
  id: string,
  name: string,
  isSelf: boolean,
  posts: CorpusPost[],
  windowDays: number,
  statsGap: number,
  avgEngagement: number,
  medianEngagement: number,
  mediaRate: number,
  avgLength: number,
  hashtagRate: number
): CompanyWatch {
  const words = new Map<string, number>();
  const bigrams = new Map<string, number>();
  const tags = new Map<string, number>();
  const themeCounts = new Map<string, number>();
  const weekSet = new Set<string>();
  const dayCounts = new Map<string, number>();
  const plat = new Map<string, number>();

  for (const p of posts) {
    // Count each term once per post: "how many posts talk about X", which is
    // what a marketer means by a key word, and immune to one keyword-stuffed post.
    const toks = tokens(p.text);
    for (const w of new Set(toks)) words.set(w, (words.get(w) ?? 0) + 1);
    const bi = new Set<string>();
    for (let i = 1; i < toks.length; i++) bi.add(`${toks[i - 1]} ${toks[i]}`);
    for (const b of bi) bigrams.set(b, (bigrams.get(b) ?? 0) + 1);
    for (const t of new Set(p.hashtags)) tags.set(t, (tags.get(t) ?? 0) + 1);
    for (const th of THEMES) if (th.re.test(p.text)) themeCounts.set(th.key, (themeCounts.get(th.key) ?? 0) + 1);

    const d = new Date(p.date + "T12:00:00Z");
    if (!Number.isNaN(d.getTime())) {
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      weekSet.add(monday.toISOString().slice(0, 10));
      const wd = WEEKDAYS[d.getUTCDay()];
      dayCounts.set(wd, (dayCounts.get(wd) ?? 0) + 1);
    }
    plat.set(p.platform, (plat.get(p.platform) ?? 0) + 1);
  }

  const dates = posts.map((p) => p.date).filter(Boolean).sort();
  const last = dates[dates.length - 1] ?? null;
  const weeksInWindow = Math.max(1, Math.round(windowDays / 7));
  const bestWeekday = Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    id,
    name,
    isSelf,
    postCount: posts.length,
    postsPerWeek: Math.round((posts.length / weeksInWindow) * 10) / 10,
    activeWeeks: weekSet.size,
    weeksInWindow,
    lastPostDate: last,
    daysSinceLastPost: last ? Math.max(0, Math.round((Date.now() - new Date(last + "T12:00:00Z").getTime()) / 86400_000)) : null,
    gapDays: statsGap,
    bestWeekday,
    avgEngagement,
    medianEngagement,
    mediaRate,
    avgLength,
    hashtagRate,
    keywords: topN(words, 25),
    phrases: topN(bigrams, 15),
    hashtags: topN(tags, 15, 1),
    themes: THEMES.map((t) => {
      const count = themeCounts.get(t.key) ?? 0;
      return { key: t.key, label: t.label, count, share: posts.length ? Math.round((count / posts.length) * 100) : 0 };
    }),
    topPosts: [...posts]
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 3)
      .map((p) => ({ date: p.date, text: p.text.slice(0, 280), engagement: p.engagement, url: p.url })),
    platforms: Array.from(plat.entries()).map(([platform, count]) => ({ platform, count })),
  };
}

async function watchFor(id: string, name: string, isSelf: boolean, windowDays: number): Promise<CompanyWatch> {
  // 250 per company keeps a 1 + 10 competitor comparison inside the Worker budget.
  const { posts, stats } = await buildCorpus(id, windowDays, 250);
  return summarize(
    id,
    name,
    isSelf,
    posts,
    windowDays,
    stats.gapDays,
    stats.avgEngagement,
    stats.medianEngagement,
    stats.mediaRate,
    stats.avgLength,
    stats.hashtagRate
  );
}

export async function buildCompetitorWatch(
  self: { id: string; name: string },
  competitors: Array<{ id: string; name: string }>,
  windowDays: number
): Promise<CompetitorWatchResult> {
  // Sequential on purpose: parallel findMany over postTextFull for 10 companies
  // is exactly the shape that has tripped Worker memory (1101/1102) before.
  const selfWatch = await watchFor(self.id, self.name, true, windowDays);
  const comp: CompanyWatch[] = [];
  for (const c of competitors) comp.push(await watchFor(c.id, c.name, false, windowDays));

  const selfTerms = new Set(selfWatch.keywords.map((k) => k.term));
  const gapMap = new Map<string, { competitors: number; mentions: number }>();
  for (const c of comp) {
    for (const k of c.keywords) {
      if (selfTerms.has(k.term)) continue;
      const g = gapMap.get(k.term) ?? { competitors: 0, mentions: 0 };
      g.competitors++;
      g.mentions += k.count;
      gapMap.set(k.term, g);
    }
  }
  const minCompetitors = comp.length >= 3 ? 2 : 1;
  const gaps = Array.from(gapMap.entries())
    .filter(([, g]) => g.competitors >= minCompetitors)
    .sort((a, b) => b[1].competitors - a[1].competitors || b[1].mentions - a[1].mentions)
    .slice(0, 20)
    .map(([term, g]) => ({ term, ...g }));

  const compTerms = new Set(comp.flatMap((c) => c.keywords.map((k) => k.term)));
  const owned = selfWatch.keywords.filter((k) => !compTerms.has(k.term)).slice(0, 12);

  const active = comp.filter((c) => c.postCount > 0);
  const themeComparison = THEMES.map((t) => {
    const s = selfWatch.themes.find((x) => x.key === t.key)?.share ?? 0;
    const avg = active.length
      ? Math.round(active.reduce((a, c) => a + (c.themes.find((x) => x.key === t.key)?.share ?? 0), 0) / active.length)
      : 0;
    return { key: t.key, label: t.label, self: s, competitors: avg };
  });

  const ranking = [selfWatch, ...comp]
    .map((c) => ({ id: c.id, name: c.name, postsPerWeek: c.postsPerWeek, avgEngagement: c.avgEngagement, isSelf: c.isSelf }))
    .sort((a, b) => b.postsPerWeek - a.postsPerWeek);

  return { windowDays, self: selfWatch, competitors: comp, gaps, owned, themeComparison, ranking };
}
