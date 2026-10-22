/**
 * Day bucketing and day judging for the posting alert ("Weekly posting check").
 *
 * Audit 2026-10-22: the week of 12–16 Oct mail said WALLIX 0/5 days, yet the
 * app later showed 5 WALLIX posts on Wed 14 Oct. Same client id in both places
 * (cmp0eqlsx000dbqj3hmvwldbe = canonical 212 Wallix), so it is not an id
 * mismatch. Three faults in the old read, all fixed here:
 *
 *  1. TIMEZONE — days were bucketed by social_posts.publishedDateLocal, which
 *     every ingest path fills with the UTC date (toISOString().slice(0,10)).
 *     A post at 20:00–23:59 New York time landed on the NEXT day. Days are now
 *     the America/New_York calendar day of publishedAtUtc (etDateKey).
 *  2. NOT YET COLLECTED ≠ NOT POSTED — the alert fired Friday 19:20 ET and
 *     judged every day whether or not the collector had read the company since.
 *     WALLIX (tracked through its CEO's /in/ profile) was only re-read on
 *     21 Oct, when 13 posts arrived at once. A day with no post is now only a
 *     MISS if the company was read after that day ended; otherwise it is
 *     "not collected yet" (pending), shown in grey and not counted.
 *  3. OBJECTIVE — the alert assumed one post every working day (x/5) even for
 *     companies whose Settings objective is lower (WALLIX: 3 a week). When the
 *     posts-per-week objective is below the working days, the check becomes
 *     "posted on N of the days", any days.
 *
 * Pure functions (no Prisma, no "@/"), unit-tested in tests/report-logic.test.ts.
 */

export const ALERT_TZ = "America/New_York";

/** Offset of `tz` from UTC at instant `date`, in ms (negative for New York). */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-10-14" — the New York calendar day of an instant. */
export function etDateKey(d: Date, tz: string = ALERT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The UTC instant of 00:00 New York time on `dateKey` ("YYYY-MM-DD"). DST-safe. */
export function etStartOfDay(dateKey: string, tz: string = ALERT_TZ): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  return new Date(guess - tzOffsetMs(new Date(first), tz));
}

/** The UTC instant at which `dateKey` ends in New York (00:00 of the next day). */
export function etEndOfDay(dateKey: string, tz: string = ALERT_TZ): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return etStartOfDay(next, tz);
}

export interface DayJudgement {
  objectiveDays: number;
  daysMet: number;
  daysMissed: number;
  /** Planned days with no post although the company was read after the day ended. */
  missedDates: string[];
  /** Planned days with no post that the collector has not re-read since — not judged. */
  pendingDates: string[];
  /** True when the objective is "N of the days" (posts-per-week below working days). */
  flexible: boolean;
}

/**
 * Judge one company's planned days.
 *
 * @param expected   planned day keys in the window, ascending ("YYYY-MM-DD", New York days)
 * @param postedDays New York day keys on which the company published at least once
 * @param lastReadAt last time the collector read this company successfully (null = never)
 * @param perWeek    posts-per-week objective (Settings), null = one per planned day
 * @param workingDaysPerWeek how many planned days make a full week (5 by default)
 */
export function judgeDays(input: {
  expected: string[];
  postedDays: Set<string>;
  lastReadAt: Date | null;
  perWeek?: number | null;
  workingDaysPerWeek?: number;
}): DayJudgement {
  const { expected, postedDays, lastReadAt } = input;
  const perDayWeek = input.workingDaysPerWeek ?? 5;
  const posted = expected.filter((d) => postedDays.has(d));
  const unposted = expected.filter((d) => !postedDays.has(d));
  const isRead = (d: string) => !!lastReadAt && lastReadAt.getTime() >= etEndOfDay(d).getTime();
  const missedDates = unposted.filter(isRead);
  const pendingDates = unposted.filter((d) => !isRead(d));

  const perWeek = input.perWeek ?? null;
  if (perWeek !== null && perWeek > 0 && perWeek < perDayWeek) {
    // "N of the days": the target scales with the planned days in the window.
    const target = Math.max(1, Math.round((perWeek * expected.length) / perDayWeek));
    const objectiveDays = Math.min(target, expected.length);
    const daysMet = Math.min(posted.length, objectiveDays);
    // Still reachable if the not-yet-collected days turn out to have posts.
    const daysMissed = Math.max(0, objectiveDays - daysMet - pendingDates.length);
    return {
      objectiveDays,
      daysMet,
      daysMissed,
      missedDates: daysMissed > 0 ? missedDates : [],
      pendingDates: daysMet >= objectiveDays ? [] : pendingDates,
      flexible: true,
    };
  }

  return {
    objectiveDays: expected.length,
    daysMet: posted.length,
    daysMissed: missedDates.length,
    missedDates,
    pendingDates,
    flexible: false,
  };
}
