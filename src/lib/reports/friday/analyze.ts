/**
 * Friday client reports (v4.78.0) — pure analysis, no database, no AI.
 *
 * Olivier, 2026-11-13: "3 reports to create on Fridays based on social content
 * collected for client: intelligence, competitive, company." Everything here
 * works on the posts the Chrome extension already collected, so it can be
 * unit-tested on fake data (tests/friday-reports.test.mts).
 */
import { TOPICS, words, hashtagsOf } from "../ops/competitive";

export type Role = "self" | "competitor";

export type FPost = {
  id: string;
  companyId: string;
  company: string;
  role: Role;
  platform: string;
  /** ET calendar day the post was published, "YYYY-MM-DD". */
  date: string;
  text: string;
  hashtagsCol: string | null;
  hasMedia: boolean;
  likes: number;
  comments: number;
  shares: number;
  url: string | null;
};

export type Term = { term: string; count: number };

export type CompanyStats = {
  id: string;
  name: string;
  role: Role;
  postsWeek: number;
  postsPrev: number;
  linkedinWeek: number;
  xWeek: number;
  engagementWeek: number;
  engagementPrev: number;
  avgEngagement: number;
  likes: number;
  comments: number;
  shares: number;
  mediaShare: number;
  activeDays: number;
  topics: Array<{ label: string; count: number; share: number }>;
  mainTopic: string | null;
  hashtags: Term[];
  keywords: Term[];
  lastPostKey: string | null;
  topPosts: FPost[];
};

export type Window = { weekFrom: string; weekTo: string; prevFrom: string; prevTo: string };

export const engagementOf = (p: Pick<FPost, "likes" | "comments" | "shares">) => p.likes + p.comments * 2 + p.shares * 3;

export function topicOf(text: string): string {
  for (const t of TOPICS) if (t.re.test(text)) return t.label;
  return "Other";
}

function top(map: Map<string, number>, n: number, min = 1): Term[] {
  return Array.from(map.entries())
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([term, count]) => ({ term, count }));
}

const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

/** Stats for one company over the report week (and the week before, for the trend). */
export function statsFor(company: { id: string; name: string; role: Role }, posts: FPost[], w: Window, lastPostKey: string | null): CompanyStats {
  const mine = posts.filter((p) => p.companyId === company.id);
  const week = mine.filter((p) => inRange(p.date, w.weekFrom, w.weekTo));
  const prev = mine.filter((p) => inRange(p.date, w.prevFrom, w.prevTo));
  const topicCount = new Map<string, number>();
  const tags = new Map<string, number>();
  const kw = new Map<string, number>();
  for (const p of week) {
    const t = topicOf(p.text);
    topicCount.set(t, (topicCount.get(t) || 0) + 1);
    for (const h of hashtagsOf(p.text, p.hashtagsCol)) tags.set(h, (tags.get(h) || 0) + 1);
    for (const k of new Set(words(p.text))) kw.set(k, (kw.get(k) || 0) + 1);
  }
  const topics = top(topicCount, 10).map((t) => ({ label: t.term, count: t.count, share: week.length ? Math.round((t.count / week.length) * 100) : 0 }));
  const eng = week.reduce((a, p) => a + engagementOf(p), 0);
  return {
    id: company.id,
    name: company.name,
    role: company.role,
    postsWeek: week.length,
    postsPrev: prev.length,
    linkedinWeek: week.filter((p) => p.platform === "LINKEDIN").length,
    xWeek: week.filter((p) => p.platform !== "LINKEDIN").length,
    engagementWeek: eng,
    engagementPrev: prev.reduce((a, p) => a + engagementOf(p), 0),
    avgEngagement: week.length ? Math.round((eng / week.length) * 10) / 10 : 0,
    likes: week.reduce((a, p) => a + p.likes, 0),
    comments: week.reduce((a, p) => a + p.comments, 0),
    shares: week.reduce((a, p) => a + p.shares, 0),
    mediaShare: week.length ? Math.round((week.filter((p) => p.hasMedia).length / week.length) * 100) : 0,
    activeDays: new Set(week.map((p) => p.date)).size,
    topics,
    mainTopic: topics.find((t) => t.label !== "Other")?.label || topics[0]?.label || null,
    hashtags: top(tags, 8),
    keywords: top(kw, 12, week.length >= 4 ? 2 : 1),
    lastPostKey,
    topPosts: [...week].sort((a, b) => engagementOf(b) - engagementOf(a) || b.date.localeCompare(a.date)).slice(0, 5),
  };
}

export type Comparison = {
  /** Share of the posts / engagement published this week by the client and its linked competitors. */
  shareOfVoice: Array<{ id: string; name: string; role: Role; posts: number; postShare: number; engagement: number; engagementShare: number }>;
  /** Words several competitors used this week that the client did not. */
  gaps: Array<{ term: string; competitors: number; mentions: number }>;
  /** Words the client used that no competitor used. */
  owned: Term[];
  /** Topic share (%), client vs competitor average. */
  topicMix: Array<{ label: string; self: number; competitors: number }>;
  rankByPosts: number;
  rankByEngagement: number;
};

export function compare(self: CompanyStats, competitors: CompanyStats[]): Comparison {
  const all = [self, ...competitors];
  const totalPosts = all.reduce((a, c) => a + c.postsWeek, 0);
  const totalEng = all.reduce((a, c) => a + c.engagementWeek, 0);
  const shareOfVoice = all
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role,
      posts: c.postsWeek,
      postShare: totalPosts ? Math.round((c.postsWeek / totalPosts) * 100) : 0,
      engagement: c.engagementWeek,
      engagementShare: totalEng ? Math.round((c.engagementWeek / totalEng) * 100) : 0,
    }))
    .sort((a, b) => b.engagement - a.engagement || b.posts - a.posts);

  const selfTerms = new Set(self.keywords.map((k) => k.term));
  const gapMap = new Map<string, { competitors: number; mentions: number }>();
  for (const c of competitors)
    for (const k of c.keywords) {
      if (selfTerms.has(k.term)) continue;
      const g = gapMap.get(k.term) || { competitors: 0, mentions: 0 };
      g.competitors++;
      g.mentions += k.count;
      gapMap.set(k.term, g);
    }
  const minComp = competitors.filter((c) => c.postsWeek > 0).length >= 3 ? 2 : 1;
  const gaps = Array.from(gapMap.entries())
    .filter(([, g]) => g.competitors >= minComp)
    .sort((a, b) => b[1].competitors - a[1].competitors || b[1].mentions - a[1].mentions)
    .slice(0, 12)
    .map(([term, g]) => ({ term, ...g }));
  const compTerms = new Set(competitors.flatMap((c) => c.keywords.map((k) => k.term)));
  const owned = self.keywords.filter((k) => !compTerms.has(k.term)).slice(0, 10);

  const active = competitors.filter((c) => c.postsWeek > 0);
  const labels = Array.from(new Set([...self.topics, ...active.flatMap((c) => c.topics)].map((t) => t.label)));
  const topicMix = labels
    .map((label) => ({
      label,
      self: self.topics.find((t) => t.label === label)?.share || 0,
      competitors: active.length ? Math.round(active.reduce((a, c) => a + (c.topics.find((t) => t.label === label)?.share || 0), 0) / active.length) : 0,
    }))
    .sort((a, b) => b.self + b.competitors - (a.self + a.competitors));

  const rank = (key: "postsWeek" | "engagementWeek") => [...all].sort((a, b) => b[key] - a[key]).findIndex((c) => c.id === self.id) + 1;
  return { shareOfVoice, gaps, owned, topicMix, rankByPosts: rank("postsWeek"), rankByEngagement: rank("engagementWeek") };
}

/** Week-over-week change as "+40%", "−25%", "new" or "=". */
export function trend(now: number, before: number): string {
  if (now === before) return "=";
  if (before === 0) return now > 0 ? "new" : "=";
  const pct = Math.round(((now - before) / before) * 100);
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}
