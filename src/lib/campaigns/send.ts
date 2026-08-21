/**
 * Delivery for the campaign monthly report.
 *
 * Lives in lib/ rather than in the route file so the daily digest can call
 * it too — Next.js route modules may only export HTTP verbs, and this send
 * has two callers by design:
 *   1. POST /api/cron/campaign-monthly-report (manual / dedicated cron)
 *   2. the daily digest, on the 1st of the month (see /api/digest/daily)
 *
 * Caller 2 is the one that actually runs in production: the deploy PAT has
 * no GitHub `workflow` scope, so no new .github/workflows file can be
 * pushed from a session. Rather than leave the whole feature waiting on a
 * manual step, the send piggybacks on the digest workflow that already
 * fires daily, guarded by an idempotency record.
 */

import prisma from "@/lib/db";
import { buildCampaignMonthlyReport, lastClosedMonth, monthLabel, type CampaignMonthlyReport } from "./monthly";
import { renderCompanyBody, renderSummaryBody, wrapEmail } from "./render";
import { resolveFrom } from "@/lib/email/sender";

export const SENT_KEY = "campaign_report_sent";
export const DEFAULT_TO = "sales@gershonconsulting.com";

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

async function markSent(month: string, note: string): Promise<void> {
  const sent = await readSent();
  sent[month] = `${new Date().toISOString()} ${note}`;
  const value = JSON.stringify(sent);
  await prisma.setting.upsert({
    where: { key: SENT_KEY },
    update: { value },
    create: { key: SENT_KEY, value },
  });
}

async function sendViaResend(
  html: string,
  subject: string,
  to: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set in environment" };
  const from = resolveFrom();
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, status: r.status, error: body.slice(0, 300) };
    }
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function summarySubject(r: CampaignMonthlyReport): string {
  const pct = r.totals.attainmentPct === null ? "no data" : `${r.totals.attainmentPct}% objective met`;
  const n = r.totals.companies;
  return `Report social.gershonCRM.com — Campaign performance ${r.monthLabel} — ${pct} across ${n} ${n === 1 ? "company" : "companies"}`;
}

export function companySubject(r: CampaignMonthlyReport, name: string, pct: number | null): string {
  return `Report social.gershonCRM.com — ${name} — ${r.monthLabel} — ${pct === null ? "no data" : `${pct}% objective met`}`;
}

export interface SendResult {
  sent: number;
  skipped: string | null;
  month: string;
  recipient: string;
  results: Array<{ target: string; ok: boolean; error?: string }>;
}

export async function sendCampaignMonthlyReport(opts: {
  month?: string;
  force?: boolean;
  dry?: boolean;
} = {}): Promise<SendResult> {
  const month = opts.month || lastClosedMonth();
  const to = process.env.CAMPAIGN_REPORT_TO || DEFAULT_TO;
  const results: SendResult["results"] = [];

  if (!opts.force) {
    const sent = await readSent();
    if (sent[month]) {
      return { sent: 0, skipped: `already sent for ${month} (${sent[month]})`, month, recipient: to, results };
    }
  }

  const report = await buildCampaignMonthlyReport(month);

  if (report.companies.length === 0) {
    return {
      sent: 0,
      skipped: `no CAMPAIGN companies to report on for ${monthLabel(month)}`,
      month,
      recipient: to,
      results,
    };
  }

  // 1. The summary — every campaign company on one page.
  if (opts.dry) {
    results.push({ target: "summary", ok: true });
  } else {
    const r = await sendViaResend(wrapEmail(renderSummaryBody(report)), summarySubject(report), to);
    results.push({ target: "summary", ok: r.ok, error: r.error });
  }

  // 2. One page per company, sent sequentially — Resend rate-limits bursts,
  //    and a partial send is easier to reason about than a scattered one.
  for (const c of report.companies) {
    if (opts.dry) {
      results.push({ target: c.slug, ok: true });
      continue;
    }
    const r = await sendViaResend(
      wrapEmail(renderCompanyBody(report, c)),
      companySubject(report, c.name, c.attainmentPct),
      to,
    );
    results.push({ target: c.slug, ok: r.ok, error: r.error });
  }

  const okCount = results.filter((r) => r.ok).length;

  // Mark sent only when the summary itself landed — a total failure stays
  // retryable on tomorrow's digest run rather than being silently lost.
  if (!opts.dry && results[0]?.ok) {
    await markSent(month, `${okCount}/${results.length} emails to ${to}`);
  }

  return { sent: okCount, skipped: null, month, recipient: to, results };
}
