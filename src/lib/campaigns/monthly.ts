/**
 * Campaign Monthly Report engine.
 *
 * Scope: clients with clientType = CAMPAIGN, not ARCHIVED. This is the
 * *only* scope — companies in every other category are deliberately
 * excluded (see project_campaign_category_rule).
 *
 * The objective we report against is ONE POST PER DAY, measured at
 * company-day granularity: a calendar day counts as MET when at least one
 * of that company's expected platforms published that day. That is a
 * different (and, for a sales-facing document, more honest) basis than
 * /api/campaigns/attainment, which counts every (platform, day) cell
 * separately. Both numbers are computed from DailyCompliance; this one
 * just collapses platforms first.
 *
 * Five headline data points per company — these are the contract for the
 * public API and must not change shape without bumping the API version:
 *   1. postsPublished   — posts actually published in the month
 *   2. objectiveDays    — days the company was expected to post
 *   3. daysMet          — days at least one post went out
 *   4. daysMissed       — objectiveDays - daysMet
 *   5. attainmentPct    — daysMet / objectiveDays, 1 decimal
 * (totalEngagement ships alongside as context, not as a headline metric.)
 *
 * Fallback: when DailyCompliance has no rows for a company/month (the
 * compliance pipeline hasn't recomputed, or the company was onboarded
 * mid-month), objectiveDays is derived from the company's PostingSchedule
 * and daysMet from distinct SocialPost.publishedDateLocal. The response
 * always states which basis was used per company, so a consumer can tell
 * a verified number from a derived one.
 */

import prisma from "@/lib/db";
import { ClientStatus, ClientType, ComplianceStatus, PostingMode } from "@prisma/client";

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";
export const REPORT_API_VERSION = 1;

export type Basis = "compliance" | "derived";

export interface PlatformSplit {
  platform: string;
  posts: number;
  engagement: number;
}

export interface CampaignMonth {
  clientId: string;
  slug: string;
  name: string;
  /** The five key data points. */
  postsPublished: number;
  objectiveDays: number;
  daysMet: number;
  daysMissed: number;
  attainmentPct: number | null;
  /** Context, not a headline metric. */
  totalEngagement: number;
  engagementBreakdown: { likes: number; comments: number; shares: number };
  basis: Basis;
  platforms: PlatformSplit[];
  missedDates: string[];
  bestPost: { url: string; snippet: string; engagement: number; platform: string } | null;
  /** Same five points for the previous month, for the trend arrows. */
  previous: {
    postsPublished: number;
    objectiveDays: number;
    daysMet: number;
    daysMissed: number;
    attainmentPct: number | null;
    totalEngagement: number;
  } | null;
  /** Permanent per-company share token. */
  shareToken: string;
  shareUrl: string;
  status: "ON_TARGET" | "AT_RISK" | "BELOW_TARGET" | "NO_DATA";
}

export interface CampaignMonthlyReport {
  apiVersion: number;
  month: string; // YYYY-MM
  monthLabel: string; // "July 2026"
  previousMonth: string;
  previousMonthLabel: string;
  generatedAt: string;
  objective: string;
  scope: string;
  totals: {
    companies: number;
    postsPublished: number;
    objectiveDays: number;
    daysMet: number;
    daysMissed: number;
    attainmentPct: number | null;
    totalEngagement: number;
    previousAttainmentPct: number | null;
  };
  companies: CampaignMonth[];
  shareToken: string;
  shareUrl: string;
}

// ─── date helpers (all UTC-normalized; dateLocal strings are already local) ───

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function previousMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The month that just closed, relative to now. */
export function lastClosedMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function allDatesIn(month: string): string[] {
  const n = daysInMonth(month);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(`${month}-${String(i).padStart(2, "0")}`);
  return out;
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
}

/** Cap a month's date list at today when the month is still running. */
function elapsedDatesIn(month: string, now = new Date()): string[] {
  const today = now.toISOString().slice(0, 10);
  return allDatesIn(month).filter((d) => d <= today);
}

function pct(met: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.round((met / expected) * 1000) / 10;
}

function statusOf(p: number | null): CampaignMonth["status"] {
  if (p === null) return "NO_DATA";
  if (p >= 95) return "ON_TARGET";
  if (p >= 80) return "AT_RISK";
  return "BELOW_TARGET";
}

// ─── share tokens ─────────────────────────────────────────────────────────────

const TOKENS_KEY = "campaign_report_tokens";

function newToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type TokenMap = Record<string, string>; // scope ("all" | clientId) -> token

async function readTokens(): Promise<TokenMap> {
  const row = await prisma.setting.findUnique({ where: { key: TOKENS_KEY } });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === "object" && parsed !== null ? (parsed as TokenMap) : {};
  } catch {
    return {};
  }
}

/**
 * Make sure every scope in `scopes` has a permanent token, creating any
 * that are missing in a single write. Tokens never rotate on their own —
 * a link handed to a client keeps working month after month.
 */
export async function ensureTokens(scopes: string[]): Promise<TokenMap> {
  const map = await readTokens();
  let changed = false;
  for (const s of scopes) {
    if (!map[s]) {
      map[s] = newToken();
      changed = true;
    }
  }
  if (changed) {
    const value = JSON.stringify(map);
    await prisma.setting.upsert({
      where: { key: TOKENS_KEY },
      update: { value },
      create: { key: TOKENS_KEY, value },
    });
  }
  return map;
}

/** Reverse lookup for the /r/[token] page. Returns "all" or a clientId. */
export async function resolveToken(token: string): Promise<string | null> {
  const map = await readTokens();
  for (const [scope, t] of Object.entries(map)) {
    if (t === token) return scope;
  }
  return null;
}

// ─── the engine ───────────────────────────────────────────────────────────────

interface RawMonth {
  postsPublished: number;
  objectiveDays: number;
  daysMet: number;
  totalEngagement: number;
  likes: number;
  comments: number;
  shares: number;
  basis: Basis;
  platforms: PlatformSplit[];
  missedDates: string[];
  bestPost: CampaignMonth["bestPost"];
}

/**
 * Compute one company-month. Kept separate from the fetch so the current
 * and previous month share exactly one code path — a trend arrow computed
 * two different ways is worse than no trend arrow.
 */
function computeMonth(
  month: string,
  compliance: Array<{ dateLocal: string; expectedFlag: boolean; status: ComplianceStatus }>,
  posts: Array<{
    publishedDateLocal: string;
    platform: string;
    postUrl: string | null;
    postTextSnippet: string | null;
    likeCount: number;
    commentCount: number;
    shareCount: number;
  }>,
  scheduleModes: PostingMode[],
  weekdaysJson: string | null,
  customTarget: number | null,
  now: Date,
): RawMonth {
  const postDates = new Set(posts.map((p) => p.publishedDateLocal));

  let likes = 0;
  let comments = 0;
  let shares = 0;
  const platformAgg = new Map<string, { posts: number; engagement: number }>();
  let bestPost: CampaignMonth["bestPost"] = null;

  for (const p of posts) {
    likes += p.likeCount ?? 0;
    comments += p.commentCount ?? 0;
    shares += p.shareCount ?? 0;
    const eng = (p.likeCount ?? 0) + (p.commentCount ?? 0) + (p.shareCount ?? 0);
    const slot = platformAgg.get(p.platform) ?? { posts: 0, engagement: 0 };
    slot.posts++;
    slot.engagement += eng;
    platformAgg.set(p.platform, slot);
    if (p.postUrl && (!bestPost || eng > bestPost.engagement)) {
      bestPost = {
        url: p.postUrl,
        snippet: (p.postTextSnippet ?? "").slice(0, 160),
        engagement: eng,
        platform: p.platform,
      };
    }
  }

  const platforms: PlatformSplit[] = Array.from(platformAgg.entries())
    .map(([platform, v]) => ({ platform, posts: v.posts, engagement: v.engagement }))
    .sort((a, b) => b.posts - a.posts);

  // Preferred basis: DailyCompliance, collapsed to company-day.
  const expectedDates = new Set<string>();
  const metDates = new Set<string>();
  for (const c of compliance) {
    if (!c.expectedFlag) continue;
    expectedDates.add(c.dateLocal);
    if (c.status === ComplianceStatus.GREEN) metDates.add(c.dateLocal);
  }

  if (expectedDates.size > 0) {
    const missed = [...expectedDates].filter((d) => !metDates.has(d)).sort();
    return {
      postsPublished: posts.length,
      objectiveDays: expectedDates.size,
      daysMet: metDates.size,
      totalEngagement: likes + comments + shares,
      likes,
      comments,
      shares,
      basis: "compliance",
      platforms,
      missedDates: missed,
      bestPost,
    };
  }

  // Fallback: derive the objective from the posting schedule.
  const candidateDates = elapsedDatesIn(month, now);
  let expected: string[];
  if (scheduleModes.includes(PostingMode.EVERY_DAY)) {
    expected = candidateDates;
  } else if (scheduleModes.includes(PostingMode.CUSTOM_WEEKDAYS) && weekdaysJson) {
    let wanted: number[] = [];
    try {
      const parsed = JSON.parse(weekdaysJson);
      if (Array.isArray(parsed)) wanted = parsed.map(Number).filter((n) => !Number.isNaN(n));
    } catch {
      wanted = [1, 2, 3, 4, 5];
    }
    expected = candidateDates.filter((d) => wanted.includes(weekdayOf(d)));
  } else if (scheduleModes.includes(PostingMode.CUSTOM_TARGET) && customTarget && customTarget > 0) {
    // A target count, not a set of days — represent it as N objective days.
    expected = candidateDates.slice(0, customTarget);
  } else {
    // WORKING_DAYS is the schema default and the house default.
    expected = candidateDates.filter((d) => {
      const w = weekdayOf(d);
      return w >= 1 && w <= 5;
    });
  }

  const met = expected.filter((d) => postDates.has(d));
  return {
    postsPublished: posts.length,
    objectiveDays: expected.length,
    daysMet: met.length,
    totalEngagement: likes + comments + shares,
    likes,
    comments,
    shares,
    basis: "derived",
    platforms,
    missedDates: expected.filter((d) => !postDates.has(d)),
    bestPost,
  };
}

export async function buildCampaignMonthlyReport(
  month: string,
  opts: { clientId?: string; now?: Date } = {},
): Promise<CampaignMonthlyReport> {
  const now = opts.now ?? new Date();
  const prev = previousMonthOf(month);

  const clients = await prisma.client.findMany({
    where: {
      clientType: ClientType.CAMPAIGN,
      status: { not: ClientStatus.ARCHIVED },
      ...(opts.clientId ? { id: opts.clientId } : {}),
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  const ids = clients.map((c) => c.id);

  if (ids.length === 0) {
    const tokens = await ensureTokens(["all"]);
    return {
      apiVersion: REPORT_API_VERSION,
      month,
      monthLabel: monthLabel(month),
      previousMonth: prev,
      previousMonthLabel: monthLabel(prev),
      generatedAt: now.toISOString(),
      objective: "One post per day",
      scope: "clientType=CAMPAIGN, not archived",
      totals: {
        companies: 0,
        postsPublished: 0,
        objectiveDays: 0,
        daysMet: 0,
        daysMissed: 0,
        attainmentPct: null,
        totalEngagement: 0,
        previousAttainmentPct: null,
      },
      companies: [],
      shareToken: tokens.all,
      shareUrl: `${APP_URL}/r/${tokens.all}`,
    };
  }

  // One query per table across both months, then bucket in memory —
  // cheaper on the Worker CPU budget than 4 round trips per company.
  const [compliance, posts, schedules] = await Promise.all([
    prisma.dailyCompliance.findMany({
      where: {
        clientId: { in: ids },
        OR: [{ dateLocal: { startsWith: `${month}-` } }, { dateLocal: { startsWith: `${prev}-` } }],
      },
      select: { clientId: true, dateLocal: true, expectedFlag: true, status: true },
    }),
    prisma.socialPost.findMany({
      where: {
        clientId: { in: ids },
        OR: [
          { publishedDateLocal: { startsWith: `${month}-` } },
          { publishedDateLocal: { startsWith: `${prev}-` } },
        ],
      },
      select: {
        clientId: true,
        publishedDateLocal: true,
        platform: true,
        postUrl: true,
        postTextSnippet: true,
        likeCount: true,
        commentCount: true,
        shareCount: true,
      },
    }),
    prisma.postingSchedule.findMany({
      where: { clientId: { in: ids } },
      select: { clientId: true, mode: true, weekdaysJson: true, customTargetCount: true },
    }),
  ]);

  const tokens = await ensureTokens(["all", ...ids]);

  const companies: CampaignMonth[] = clients.map((c) => {
    const cCompliance = compliance.filter((r) => r.clientId === c.id);
    const cPosts = posts.filter((r) => r.clientId === c.id);
    const cSchedules = schedules.filter((r) => r.clientId === c.id);
    const modes = cSchedules.map((s) => s.mode);
    const weekdays = cSchedules.find((s) => s.weekdaysJson)?.weekdaysJson ?? null;
    const target = cSchedules.find((s) => s.customTargetCount)?.customTargetCount ?? null;

    const cur = computeMonth(
      month,
      cCompliance.filter((r) => r.dateLocal.startsWith(`${month}-`)),
      cPosts.filter((r) => r.publishedDateLocal.startsWith(`${month}-`)),
      modes,
      weekdays,
      target,
      now,
    );
    const pre = computeMonth(
      prev,
      cCompliance.filter((r) => r.dateLocal.startsWith(`${prev}-`)),
      cPosts.filter((r) => r.publishedDateLocal.startsWith(`${prev}-`)),
      modes,
      weekdays,
      target,
      now,
    );

    const attainmentPct = pct(cur.daysMet, cur.objectiveDays);
    const token = tokens[c.id];

    return {
      clientId: c.id,
      slug: c.slug,
      name: c.name,
      postsPublished: cur.postsPublished,
      objectiveDays: cur.objectiveDays,
      daysMet: cur.daysMet,
      daysMissed: Math.max(0, cur.objectiveDays - cur.daysMet),
      attainmentPct,
      totalEngagement: cur.totalEngagement,
      engagementBreakdown: { likes: cur.likes, comments: cur.comments, shares: cur.shares },
      basis: cur.basis,
      platforms: cur.platforms,
      missedDates: cur.missedDates,
      bestPost: cur.bestPost,
      previous:
        pre.objectiveDays > 0 || pre.postsPublished > 0
          ? {
              postsPublished: pre.postsPublished,
              objectiveDays: pre.objectiveDays,
              daysMet: pre.daysMet,
              daysMissed: Math.max(0, pre.objectiveDays - pre.daysMet),
              attainmentPct: pct(pre.daysMet, pre.objectiveDays),
              totalEngagement: pre.totalEngagement,
            }
          : null,
      shareToken: token,
      shareUrl: `${APP_URL}/r/${token}`,
      status: statusOf(attainmentPct),
    };
  });

  const totObjective = companies.reduce((s, c) => s + c.objectiveDays, 0);
  const totMet = companies.reduce((s, c) => s + c.daysMet, 0);
  const prevObjective = companies.reduce((s, c) => s + (c.previous?.objectiveDays ?? 0), 0);
  const prevMet = companies.reduce((s, c) => s + (c.previous?.daysMet ?? 0), 0);

  return {
    apiVersion: REPORT_API_VERSION,
    month,
    monthLabel: monthLabel(month),
    previousMonth: prev,
    previousMonthLabel: monthLabel(prev),
    generatedAt: now.toISOString(),
    objective: "One post per day",
    scope: "clientType=CAMPAIGN, not archived",
    totals: {
      companies: companies.length,
      postsPublished: companies.reduce((s, c) => s + c.postsPublished, 0),
      objectiveDays: totObjective,
      daysMet: totMet,
      daysMissed: companies.reduce((s, c) => s + c.daysMissed, 0),
      attainmentPct: pct(totMet, totObjective),
      totalEngagement: companies.reduce((s, c) => s + c.totalEngagement, 0),
      previousAttainmentPct: pct(prevMet, prevObjective),
    },
    companies,
    shareToken: tokens.all,
    shareUrl: `${APP_URL}/r/${tokens.all}`,
  };
}
