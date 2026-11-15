/**
 * Friday client reports — "one pack per client per report Friday" (v4.78.5).
 *
 * Why (e-mail audit 2026-11-15): the pack went out twice within 24 h —
 * 2026-11-14 00:17Z (the Friday 19:00Z cron, started ~5 h late by GitHub =
 * Fri 19:17 ET, day key 2026-11-13, "week of Nov 6 – Nov 12") and again
 * 2026-11-14 22:48Z (the one-off Saturday cron line = Sat 17:48 ET, day key
 * 2026-11-14, "week of Nov 7 – Nov 13"). The sent-marker was keyed on the ET
 * day the job happened to run, so a second run on another ET day (late cron,
 * catch-up line, manual dispatch) looked like a new report and re-sent everything.
 *
 * Now every run is pinned to its REPORT FRIDAY = the latest Friday (ET) on or
 * before the run's ET day. A Friday run that slips past midnight UTC, a Saturday
 * catch-up or a manual re-run all resolve to the same Friday, so they share
 * the same week window, subject, sent-marker and Resend Idempotency-Key.
 *
 * No DB / network imports here, so tests/friday-once.test.mts can run it as is.
 */
import { etDayKey } from "../et-days";

export type FridayKindId = "company" | "competitive" | "intelligence";
export type FridayWeek = { weekFrom: string; weekTo: string; prevFrom: string; prevTo: string };

const FRIDAY = 5;

/** "2026-11-13" ± n days, pure calendar arithmetic (no time zone involved). */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 5 = Friday, for a "YYYY-MM-DD" calendar day. */
export function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The report Friday (ET) a run at `now` belongs to: the latest Friday on or before today ET. */
export function fridayReportDay(now: Date = new Date()): string {
  const today = etDayKey(0, now);
  return addDays(today, -((weekdayOf(today) - FRIDAY + 7) % 7));
}

/** The 7 full ET days before the report Friday (Fri–Thu) and the 7 before those. */
export function fridayWeekFor(reportDay: string): FridayWeek {
  return { weekFrom: addDays(reportDay, -7), weekTo: addDays(reportDay, -1), prevFrom: addDays(reportDay, -14), prevTo: addDays(reportDay, -8) };
}

/** Sent-marker key in Setting `friday_reports_sent` (same shape as v4.78.0, so markers already written on a Friday still count). */
export function fridaySentKey(kind: FridayKindId, clientId: string, reportDay: string): string {
  return `${kind}:${clientId}:${reportDay}`;
}

/** Resend Idempotency-Key: Resend itself drops a repeat with this key for 24 h, even if our marker write was lost. */
export function fridayIdempotencyKey(kind: FridayKindId, clientId: string, reportDay: string): string {
  return `social-client-${clientId}-${kind}-${reportDay}`;
}

export type OnceEmail = { kind: FridayKindId; subject: string; html: string };
export type OnceResult = { kind: FridayKindId; subject: string; sent: boolean; skipped?: string; error?: string };
export type OnceDeps = {
  /** POST one e-mail to Resend; `idempotencyKey` goes in the Idempotency-Key header when set. */
  post: (e: OnceEmail, idempotencyKey: string | null) => Promise<{ status: number; text: string }>;
  readSent: () => Promise<Record<string, string>>;
  markSent: (key: string) => Promise<void>;
};

/**
 * Send each e-mail at most once per client per report Friday.
 * `force` re-sends (no marker check, no idempotency key); `testOnly` (?to=) sends
 * without checking or writing the marker, like v4.78.0.
 */
export async function sendOncePerReportDay(
  clientId: string,
  reportDay: string,
  emails: OnceEmail[],
  deps: OnceDeps,
  opts: { force?: boolean; testOnly?: boolean } = {},
): Promise<OnceResult[]> {
  const sent = opts.force || opts.testOnly ? {} : await deps.readSent();
  const out: OnceResult[] = [];
  for (const e of emails) {
    const key = fridaySentKey(e.kind, clientId, reportDay);
    const base = { kind: e.kind, subject: e.subject };
    if (sent[key]) {
      out.push({ ...base, sent: false, skipped: `already sent for report day ${reportDay} (${sent[key]})` });
      continue;
    }
    const idem = opts.force || opts.testOnly ? null : fridayIdempotencyKey(e.kind, clientId, reportDay);
    try {
      const r = await deps.post(e, idem);
      if (r.status === 409 && idem) {
        // Resend already accepted this key in the last 24 h (or one is in flight): it was sent.
        await deps.markSent(key).catch(() => undefined);
        out.push({ ...base, sent: false, skipped: `already sent for report day ${reportDay} (Resend idempotency key)` });
        continue;
      }
      if (r.status < 200 || r.status >= 300) {
        out.push({ ...base, sent: false, error: `Resend ${r.status}: ${r.text.slice(0, 200)}` });
        continue;
      }
      if (!opts.testOnly) await deps.markSent(key).catch(() => undefined);
      out.push({ ...base, sent: true });
    } catch (err) {
      out.push({ ...base, sent: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
