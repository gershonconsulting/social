/**
 * Posting alerts — the "something is wrong" watchdog.
 *
 * Two alerts, one engine:
 *   - WEEK  : fires at the end of the working week and names every campaign
 *             company that did not post on all of its planned days that week.
 *   - MONTH : same read over the month that just closed.
 *
 * Scope is clientType = CAMPAIGN, not archived — the same scope as the
 * campaign monthly report (see project_campaign_category_rule). Recipient is
 * social@gershonconsulting.com unless POSTING_ALERT_TO says otherwise.
 *
 * SILENT WHEN HEALTHY. An email only goes out when at least one company
 * missed a planned day; a clean week sends nothing. That keeps the alert
 * meaningful — if it lands in the inbox, something needs doing.
 *
 * The objective basis mirrors lib/campaigns/monthly.ts: DailyCompliance
 * collapsed to company-day where rows exist, otherwise derived from the
 * company's PostingSchedule against distinct SocialPost.publishedDateLocal.
 * Each company states which basis was used so a verified miss can be told
 * apart from an inferred one.
 *
 * Idempotency: every send records its period key in the `settings` row
 * `posting_alert_sent`, so a retry, a manual dispatch, and the daily-digest
 * fallback can all fire without double-sending.
 */

import prisma from "@/lib/db";
import { ClientStatus, ClientType, ComplianceStatus, PostingMode } from "@prisma/client";

export const SENT_KEY = "posting_alert_sent";
export const DEFAULT_TO = "social@gershonconsulting.com";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";

export type PeriodKind = "week" | "month";
export type Basis = "compliance" | "derived";

export interface AlertCompany {
  clientId: string;
  name: string;
  slug: string;
  objectiveDays: number;
  daysMet: number;
  daysMissed: number;
  attainmentPct: number | null;
  missedDates: string[];
  postsPublished: number;
  basis: Basis;
}

export interface PostingAlert {
  kind: PeriodKind;
  /** Idempotency key: "week:2026-08-21" (the Friday) or "month:2026-07". */
  periodKey: string;
  periodLabel: string;
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
  generatedAt: string;
  totals: {
    companies: number;
    companiesOffTarget: number;
    objectiveDays: number;
    daysMet: number;
    daysMissed: number;
    attainmentPct: number | null;
  };
  offTarget: AlertCompany[];
  onTarget: AlertCompany[];
  healthy: boolean;
}

// ─── period maths (all in UTC; dateLocal columns are plain YYYY-MM-DD) ────────

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * The working week (Mon–Fri) that has just finished. Fired on Friday evening
 * it means this week; fired any time over the weekend it still means the same
 * week, so a Friday cron and a Saturday fallback agree on the period key.
 */
export function weekPeriod(now = new Date()): { from: string; to: string; key: string; label: string } {
  const dow = now.getUTCDay(); // 0=Sun … 6=Sat
  // Step back to the most recent Friday (today, when today is a Friday).
  const backToFriday = dow === 5 ? 0 : dow === 6 ? 1 : dow + 2;
  const friday = addDays(now, -backToFriday);
  const monday = addDays(friday, -4);
  const from = iso(monday);
  const to = iso(friday);
  return {
    from,
    to,
    key: `week:${to}`,
    label: `week of ${fmtDate(from)} – ${fmtDate(to)}`,
  };
}

/** The calendar month that just closed. */
export function monthPeriod(now = new Date()): { from: string; to: string; key: string; label: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const ym = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    from: iso(first),
    to: iso(last),
    key: `month:${ym}`,
    label: first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export function fmtDate(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(iso(d));
    d = addDays(d, 1);
  }
  return out;
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function pct(met: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.round((met / expected) * 1000) / 10;
}

// ─── the read ────────────────────────────────────────────────────────────────

export async function buildPostingAlert(
  kind: PeriodKind,
  opts: { now?: Date; from?: string; to?: string } = {},
): Promise<PostingAlert> {
  const now = opts.now ?? new Date();
  const period = kind === "week" ? weekPeriod(now) : monthPeriod(now);
  const from = opts.from ?? period.from;
  const to = opts.to ?? period.to;
  // Never judge a day that hasn't happened yet.
  const today = iso(now);
  const effectiveTo = to > today ? today : to;

  const clients = await prisma.client.findMany({
    where: { clientType: ClientType.CAMPAIGN, status: { not: ClientStatus.ARCHIVED } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  const ids = clients.map((c) => c.id);

  const empty: PostingAlert = {
    kind,
    periodKey: period.key,
    periodLabel: period.label,
    from,
    to: effectiveTo,
    generatedAt: now.toISOString(),
    totals: { companies: 0, companiesOffTarget: 0, objectiveDays: 0, daysMet: 0, daysMissed: 0, attainmentPct: null },
    offTarget: [],
    onTarget: [],
    healthy: true,
  };
  if (ids.length === 0) return empty;

  const [compliance, posts, schedules] = await Promise.all([
    prisma.dailyCompliance.findMany({
      where: { clientId: { in: ids }, dateLocal: { gte: from, lte: effectiveTo } },
      select: { clientId: true, dateLocal: true, expectedFlag: true, status: true },
    }),
    prisma.socialPost.findMany({
      where: { clientId: { in: ids }, publishedDateLocal: { gte: from, lte: effectiveTo } },
      select: { clientId: true, publishedDateLocal: true },
    }),
    prisma.postingSchedule.findMany({
      where: { clientId: { in: ids } },
      select: { clientId: true, mode: true, weekdaysJson: true, customTargetCount: true },
    }),
  ]);

  const window = datesBetween(from, effectiveTo);

  const rows: AlertCompany[] = clients.map((c) => {
    const cComp = compliance.filter((r) => r.clientId === c.id);
    const cPosts = posts.filter((r) => r.clientId === c.id);
    const postDates = new Set(cPosts.map((p) => p.publishedDateLocal));

    // Preferred basis: DailyCompliance collapsed to company-day.
    const expectedDates = new Set<string>();
    const metDates = new Set<string>();
    for (const r of cComp) {
      if (!r.expectedFlag) continue;
      expectedDates.add(r.dateLocal);
      if (r.status === ComplianceStatus.GREEN) metDates.add(r.dateLocal);
    }

    let objectiveDays: number;
    let daysMet: number;
    let missedDates: string[];
    let basis: Basis;

    if (expectedDates.size > 0) {
      objectiveDays = expectedDates.size;
      daysMet = metDates.size;
      missedDates = [...expectedDates].filter((d) => !metDates.has(d)).sort();
      basis = "compliance";
    } else {
      const cSchedules = schedules.filter((s) => s.clientId === c.id);
      const modes = cSchedules.map((s) => s.mode);
      let expected: string[];
      if (modes.includes(PostingMode.EVERY_DAY)) {
        expected = window;
      } else if (modes.includes(PostingMode.CUSTOM_WEEKDAYS)) {
        const json = cSchedules.find((s) => s.weekdaysJson)?.weekdaysJson ?? null;
        let wanted: number[] = [1, 2, 3, 4, 5];
        try {
          const parsed = json ? JSON.parse(json) : null;
          if (Array.isArray(parsed)) wanted = parsed.map(Number).filter((n) => !Number.isNaN(n));
        } catch { /* fall back to Mon–Fri */ }
        expected = window.filter((d) => wanted.includes(weekdayOf(d)));
      } else if (modes.includes(PostingMode.CUSTOM_TARGET)) {
        const target = cSchedules.find((s) => s.customTargetCount)?.customTargetCount ?? 0;
        expected = window.slice(0, Math.max(0, target));
      } else {
        // WORKING_DAYS — the schema default and the house default.
        expected = window.filter((d) => { const w = weekdayOf(d); return w >= 1 && w <= 5; });
      }
      objectiveDays = expected.length;
      daysMet = expected.filter((d) => postDates.has(d)).length;
      missedDates = expected.filter((d) => !postDates.has(d));
      basis = "derived";
    }

    return {
      clientId: c.id,
      name: c.name,
      slug: c.slug,
      objectiveDays,
      daysMet,
      daysMissed: Math.max(0, objectiveDays - daysMet),
      attainmentPct: pct(daysMet, objectiveDays),
      missedDates,
      postsPublished: cPosts.length,
      basis,
    };
  });

  const offTarget = rows
    .filter((r) => r.objectiveDays > 0 && r.daysMissed > 0)
    .sort((a, b) => b.daysMissed - a.daysMissed || a.name.localeCompare(b.name));
  const onTarget = rows.filter((r) => !(r.objectiveDays > 0 && r.daysMissed > 0));

  const objectiveDays = rows.reduce((s, r) => s + r.objectiveDays, 0);
  const daysMet = rows.reduce((s, r) => s + r.daysMet, 0);

  return {
    kind,
    periodKey: period.key,
    periodLabel: period.label,
    from,
    to: effectiveTo,
    generatedAt: now.toISOString(),
    totals: {
      companies: rows.length,
      companiesOffTarget: offTarget.length,
      objectiveDays,
      daysMet,
      daysMissed: Math.max(0, objectiveDays - daysMet),
      attainmentPct: pct(daysMet, objectiveDays),
    },
    offTarget,
    onTarget,
    healthy: offTarget.length === 0,
  };
}
