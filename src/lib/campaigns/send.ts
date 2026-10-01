/**
 * Month-end report delivery — now a thin delegate to the v4.15.0 monthly
 * reports (src/lib/reports/monthly): one report per client category plus
 * each campaign company's own report, one page each, positives only.
 *
 * The older campaign email (missed days, at-risk statuses, sent to sales@)
 * broke Olivier's 2026-10-01 rule "highlight the positives, no negative
 * aspects", so it no longer goes out. Its audience is kept: sales@ receives
 * the Campaigns report. The campaign API (/api/campaigns/monthly) and the
 * /r/<token> share links are untouched — they live in ./monthly.ts.
 *
 * This file keeps its public names so both callers work unchanged:
 *   1. the daily digest, on the 1st of the month (see /api/digest/daily)
 *   2. POST /api/cron/campaign-monthly-report (manual / dedicated cron)
 * Delivery is idempotent PER REPORT in settings.monthly_report_sent.
 */

import prisma from "@/lib/db";
import { runMonthlyReports } from "@/lib/reports/monthly/send";

/** Legacy idempotency record of the old campaign email (read-only now). */
export const SENT_KEY = "campaign_report_sent";
export const DEFAULT_TO = "report@gershonconsulting.com, sales@gershonconsulting.com";

export async function readSent(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: SENT_KEY } });
  if (!row?.value) return {};
  try {
    const p = JSON.parse(row.value);
    return typeof p === "object" && p !== null ? p : {};
  } catch {
    return {};
  }
}

export interface SendResult {
  sent: number;
  skipped: string | null;
  month: string;
  recipient: string;
  results: Array<{ target: string; ok: boolean; error?: string; skipped?: string }>;
}

export async function sendCampaignMonthlyReport(opts: {
  month?: string;
  force?: boolean;
  dry?: boolean;
} = {}): Promise<SendResult> {
  const r = await runMonthlyReports({ month: opts.month, force: opts.force, dry: opts.dry });
  const results = r.results.map((x) => ({ target: x.item, ok: !!x.ok, error: x.error, skipped: x.skipped }));
  const sent = r.results.filter((x) => x.ok && !x.skipped).length;
  return {
    sent,
    skipped: sent === 0 && results.every((x) => x.skipped) ? "nothing left to send for this month" : null,
    month: r.month,
    recipient: "category reports → report@ (+ sales@ for Campaigns); company reports → each company's registered users",
    results,
  };
}
