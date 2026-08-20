/**
 * Delivery for the daily progress report.
 *
 * Lives in lib/ rather than in the route because Next.js route modules may
 * only export HTTP verbs, and two callers need it by design:
 *   1. POST /api/report/daily  — the dedicated cron / manual run
 *   2. the daily digest        — a safety net, for as long as the dedicated
 *      workflow file is not installed (the deploy PAT has no GitHub
 *      `workflow` scope, so new .github/workflows files must be added by hand)
 *
 * Both paths share one idempotency record keyed on the ET day being reported,
 * so whichever fires first wins and the other no-ops. A retry, a manual
 * dispatch, or both schedules firing cannot produce two emails for one day.
 */

import prisma from "@/lib/db";
import { buildDailyReport, REPORT_SENT_KEY, DEFAULT_REPORT_TO, type DailyReport } from "./daily-report";
import { renderDailyReportHtml, dailyReportSubject } from "./daily-report-render";

const KEEP_KEYS = 30;

async function readSent(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: REPORT_SENT_KEY } });
  if (!row?.value) return {};
  try {
    const p = JSON.parse(row.value);
    return typeof p === "object" && p !== null ? p : {};
  } catch {
    return {};
  }
}

async function markSent(dayKey: string, note: string): Promise<void> {
  const sent = await readSent();
  sent[dayKey] = `${new Date().toISOString()} ${note}`;
  const keys = Object.keys(sent).sort();
  while (keys.length > KEEP_KEYS) {
    const drop = keys.shift();
    if (drop) delete sent[drop];
  }
  const value = JSON.stringify(sent);
  await prisma.setting.upsert({
    where: { key: REPORT_SENT_KEY },
    update: { value },
    create: { key: REPORT_SENT_KEY, value },
  });
}

export interface SendResult {
  dayKey: string;
  subject: string;
  sent: boolean;
  skipped: string | null;
  to: string;
  status?: number;
  error?: string;
  report: DailyReport;
}

async function sendViaResend(
  html: string,
  subject: string,
  to: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set in environment" };
  const from = process.env.DIGEST_FROM || "onboarding@resend.dev";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, status: r.status, error: body.slice(0, 400) };
    }
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendDailyReport(opts: { force?: boolean; to?: string } = {}): Promise<SendResult> {
  const report = await buildDailyReport();
  const subject = dailyReportSubject(report);
  const to = opts.to || process.env.REPORT_TO || DEFAULT_REPORT_TO;
  const dayKey = report.day.key;

  if (!opts.force) {
    const sent = await readSent();
    if (sent[dayKey]) {
      return { dayKey, subject, sent: false, skipped: `already sent (${sent[dayKey]})`, to, report };
    }
  }

  const html = renderDailyReportHtml(report);
  const res = await sendViaResend(html, subject, to);
  if (res.ok) {
    try {
      await markSent(dayKey, `→ ${to}`);
    } catch {
      /* the mail is out; a bookkeeping failure must not fail the send */
    }
  }
  return {
    dayKey,
    subject,
    sent: res.ok,
    skipped: null,
    to,
    status: res.status,
    error: res.error,
    report,
  };
}
