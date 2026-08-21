/**
 * Delivery for the posting alerts.
 *
 * Lives in lib/ rather than in the route so the daily digest can call it too
 * (Next.js route modules may only export HTTP verbs). Two callers by design:
 *   1. POST /api/cron/posting-alert         — the dedicated cron / manual run
 *   2. the daily digest — a safety net, in case the dedicated workflow file
 *      is not in place (the deploy PAT has no GitHub `workflow` scope, so a
 *      new .github/workflows file has to be added by hand in the UI).
 *
 * Both paths are guarded by the same idempotency record, so whichever fires
 * first wins and the other no-ops.
 */

import prisma from "@/lib/db";
import { buildPostingAlert, SENT_KEY, DEFAULT_TO, type PeriodKind, type PostingAlert } from "./posting-alerts";
import { alertSubject, renderAlertBody, wrapAlertEmail } from "./render";
import { resolveFrom } from "@/lib/email/sender";

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

async function markSent(key: string, note: string): Promise<void> {
  const sent = await readSent();
  sent[key] = `${new Date().toISOString()} ${note}`;
  const value = JSON.stringify(sent);
  await prisma.setting.upsert({
    where: { key: SENT_KEY },
    update: { value },
    create: { key: SENT_KEY, value },
  });
}

async function sendViaResend(html: string, subject: string, to: string) {
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

export interface AlertSendResult {
  sent: number;
  skipped: string | null;
  kind: PeriodKind;
  periodKey: string;
  recipient: string;
  companiesOffTarget: number;
  alert: PostingAlert | null;
}

export async function sendPostingAlert(opts: {
  kind: PeriodKind;
  now?: Date;
  force?: boolean;
  dry?: boolean;
} = { kind: "week" }): Promise<AlertSendResult> {
  const to = process.env.POSTING_ALERT_TO || DEFAULT_TO;
  const alert = await buildPostingAlert(opts.kind, { now: opts.now });

  const base = {
    kind: opts.kind,
    periodKey: alert.periodKey,
    recipient: to,
    companiesOffTarget: alert.totals.companiesOffTarget,
    alert,
  };

  if (!opts.force) {
    const sent = await readSent();
    if (sent[alert.periodKey]) {
      return { ...base, sent: 0, skipped: `already sent for ${alert.periodKey} (${sent[alert.periodKey]})` };
    }
  }

  // Silent when healthy — the whole point of the watchdog.
  if (alert.healthy) {
    if (!opts.dry) await markSent(alert.periodKey, "healthy — nothing sent");
    return { ...base, sent: 0, skipped: `all ${alert.totals.companies} campaign companies hit every planned day` };
  }

  if (opts.dry) return { ...base, sent: 0, skipped: "dry run" };

  const r = await sendViaResend(wrapAlertEmail(renderAlertBody(alert)), alertSubject(alert), to);
  if (r.ok) await markSent(alert.periodKey, `alert to ${to} — ${alert.totals.companiesOffTarget} off target`);

  return { ...base, sent: r.ok ? 1 : 0, skipped: r.ok ? null : `send failed: ${r.error ?? "unknown"}` };
}

/**
 * Which alerts are due right now, given the clock. Used by both the dedicated
 * cron and the daily-digest fallback so the "when" lives in one place.
 *
 * - week  : Friday from 20:00 UTC (16:00 ET) onward, and all weekend — so a
 *           Friday-evening cron fires it, and a Saturday/Sunday digest run
 *           still catches it if that workflow was never installed.
 * - month : the 1st of the month, for the month that just closed.
 */
export function dueAlerts(now = new Date()): PeriodKind[] {
  const due: PeriodKind[] = [];
  const dow = now.getUTCDay();
  const hour = now.getUTCHours();
  if ((dow === 5 && hour >= 20) || dow === 6 || dow === 0) due.push("week");
  if (now.getUTCDate() === 1) due.push("month");
  return due;
}
