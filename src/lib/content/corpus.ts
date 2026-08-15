/**
 * Content corpus + statistics layer.
 *
 * Everything the Content Intelligence engine needs is derived here, in plain
 * TypeScript, from the SocialPost rows we already collect. Two reasons to keep
 * this separate from the AI call:
 *   1. The stats are useful on their own — the UI renders them even when no
 *      Anthropic key is configured, and they never cost anything.
 *   2. Feeding the model pre-computed numbers (engagement per hashtag, cadence,
 *      best/worst posts) produces far better analysis than dumping raw text and
 *      hoping it counts correctly.
 */

import prisma from "@/lib/db";

export type CorpusPost = {
  id: string;
  platform: string;
  date: string;
  text: string;
  hashtags: string[];
  hasMedia: boolean;
  likes: number;
  comments: number;
  shares: number;
  views: number;
  engagement: number;
  url: string | null;
};

export type HashtagStat = {
  tag: string;
  count: number;
  avgEngagement: number;
  lastUsed: string;
};

export type ContentStats = {
  postCount: number;
  windowDays: number;
  firstPostDate: string | null;
  lastPostDate: string | null;
  platforms: Array<{ platform: string; count: number; avgEngagement: number }>;
  byMonth: Array<{ month: string; count: number; avgEngagement: number }>;
  byWeekday: Array<{ weekday: string; count: number; avgEngagement: number }>;
  avgEngagement: number;
  medianEngagement: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  mediaRate: number;
  avgLength: number;
  hashtagRate: number;
  avgHashtagsPerPost: number;
  hashtags: HashtagStat[];
  topPosts: CorpusPost[];
  bottomPosts: CorpusPost[];
  gapDays: number;
};

export type Corpus = {
  posts: CorpusPost[];
  stats: ContentStats;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Pull hashtags out of the dedicated column (JSON or loose) and the body text. */
function extractHashtags(raw: string | null, text: string): string[] {
  const out = new Set<string>();

  if (raw) {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      tags = raw.split(/[,\s#]+/);
    }
    for (const t of tags) {
      const clean = t.trim().replace(/^#/, "").toLowerCase();
      if (clean.length >= 2) out.add(clean);
    }
  }

  for (const m of text.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) {
    out.add(m[1].toLowerCase());
  }

  return Array.from(out);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/**
 * Build the corpus for one company.
 *
 * `take` is capped hard: on Cloudflare Workers an unbounded findMany over
 * postTextFull has historically blown the CPU/memory budget (errors 1101/1102).
 */
export async function buildCorpus(
  clientId: string,
  windowDays: number,
  take = 400
): Promise<Corpus> {
  const since = new Date(Date.now() - windowDays * 86400_000);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await prisma.socialPost.findMany({
    where: { clientId, publishedDateLocal: { gte: sinceStr } },
    select: {
      id: true,
      platform: true,
      publishedDateLocal: true,
      postTextSnippet: true,
      postTextFull: true,
      hashtags: true,
      hasMedia: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      viewCount: true,
      postUrl: true,
    },
    orderBy: { publishedDateLocal: "desc" },
    take,
  });

  const posts: CorpusPost[] = rows.map((r) => {
    const text = (r.postTextFull || r.postTextSnippet || "").trim();
    return {
      id: r.id,
      platform: r.platform,
      date: r.publishedDateLocal,
      text,
      hashtags: extractHashtags(r.hashtags, text),
      hasMedia: r.hasMedia,
      likes: r.likeCount,
      comments: r.commentCount,
      shares: r.shareCount,
      views: r.viewCount,
      // Comments and shares are far stronger intent signals than a like, so
      // they're weighted up. Views are excluded — only X reports them, and
      // including them would make cross-platform comparison meaningless.
      engagement: r.likeCount + r.commentCount * 3 + r.shareCount * 5,
      url: r.postUrl,
    };
  });

  return { posts, stats: computeStats(posts, windowDays) };
}

export function computeStats(posts: CorpusPost[], windowDays: number): ContentStats {
  const engagements = posts.map((p) => p.engagement);
  const dates = posts.map((p) => p.date).filter(Boolean).sort();

  // ── per platform ──
  const platMap = new Map<string, number[]>();
  for (const p of posts) {
    if (!platMap.has(p.platform)) platMap.set(p.platform, []);
    platMap.get(p.platform)!.push(p.engagement);
  }
  const platforms = Array.from(platMap.entries())
    .map(([platform, e]) => ({ platform, count: e.length, avgEngagement: avg(e) }))
    .sort((a, b) => b.count - a.count);

  // ── per month ──
  const monthMap = new Map<string, number[]>();
  for (const p of posts) {
    const m = p.date.slice(0, 7);
    if (!monthMap.has(m)) monthMap.set(m, []);
    monthMap.get(m)!.push(p.engagement);
  }
  const byMonth = Array.from(monthMap.entries())
    .map(([month, e]) => ({ month, count: e.length, avgEngagement: avg(e) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // ── per weekday ──
  const dayMap = new Map<string, number[]>();
  for (const p of posts) {
    const d = new Date(p.date + "T12:00:00Z");
    if (Number.isNaN(d.getTime())) continue;
    const wd = WEEKDAYS[d.getUTCDay()];
    if (!dayMap.has(wd)) dayMap.set(wd, []);
    dayMap.get(wd)!.push(p.engagement);
  }
  const byWeekday = WEEKDAYS.filter((w) => dayMap.has(w)).map((weekday) => ({
    weekday,
    count: dayMap.get(weekday)!.length,
    avgEngagement: avg(dayMap.get(weekday)!),
  }));

  // ── hashtags ──
  const tagMap = new Map<string, { count: number; eng: number[]; lastUsed: string }>();
  for (const p of posts) {
    for (const t of p.hashtags) {
      const e = tagMap.get(t);
      if (e) {
        e.count++;
        e.eng.push(p.engagement);
        if (p.date > e.lastUsed) e.lastUsed = p.date;
      } else {
        tagMap.set(t, { count: 1, eng: [p.engagement], lastUsed: p.date });
      }
    }
  }
  const hashtags = Array.from(tagMap.entries())
    .map(([tag, d]) => ({
      tag,
      count: d.count,
      avgEngagement: avg(d.eng),
      lastUsed: d.lastUsed,
    }))
    .sort((a, b) => b.count - a.count || b.avgEngagement - a.avgEngagement)
    .slice(0, 40);

  // ── best / worst ──
  const ranked = [...posts].sort((a, b) => b.engagement - a.engagement);
  const topPosts = ranked.slice(0, 10);
  const bottomPosts = ranked.filter((p) => p.text.length > 40).slice(-10).reverse();

  // ── longest silence in the window ──
  let gapDays = 0;
  const uniqueDates = Array.from(new Set(dates));
  for (let i = 1; i < uniqueDates.length; i++) {
    const a = new Date(uniqueDates[i - 1] + "T00:00:00Z").getTime();
    const b = new Date(uniqueDates[i] + "T00:00:00Z").getTime();
    gapDays = Math.max(gapDays, Math.round((b - a) / 86400_000));
  }

  const withTags = posts.filter((p) => p.hashtags.length > 0).length;

  return {
    postCount: posts.length,
    windowDays,
    firstPostDate: dates[0] ?? null,
    lastPostDate: dates[dates.length - 1] ?? null,
    platforms,
    byMonth,
    byWeekday,
    avgEngagement: avg(engagements),
    medianEngagement: median(engagements),
    totalLikes: posts.reduce((a, p) => a + p.likes, 0),
    totalComments: posts.reduce((a, p) => a + p.comments, 0),
    totalShares: posts.reduce((a, p) => a + p.shares, 0),
    mediaRate: posts.length ? Math.round((posts.filter((p) => p.hasMedia).length / posts.length) * 100) : 0,
    avgLength: posts.length ? Math.round(posts.reduce((a, p) => a + p.text.length, 0) / posts.length) : 0,
    hashtagRate: posts.length ? Math.round((withTags / posts.length) * 100) : 0,
    avgHashtagsPerPost:
      posts.length ? Math.round((posts.reduce((a, p) => a + p.hashtags.length, 0) / posts.length) * 10) / 10 : 0,
    hashtags,
    topPosts,
    bottomPosts,
    gapDays,
  };
}
