/**
 * Day boundaries in the business timezone (America/New_York).
 *
 * "Yesterday" in the daily report means yesterday as Olivier lived it, not a
 * rolling 24h window and not a UTC day — a report that lands at 8am ET must
 * cover 00:00–23:59 ET of the previous calendar day.
 *
 * Edge runtime has full ICU, so Intl is available; Date arithmetic is done by
 * shifting into "ET wall-clock expressed as UTC" and back.
 *
 * v4.78.4: the ET offset is read ONLY from Intl.DateTimeFormat(timeZone:
 * America/New_York).formatToParts for the given instant, then rebuilt with
 * Date.UTC. Nothing goes through the machine's local time zone any more (the
 * old version re-parsed toLocaleString() output with `new Date(string)`, which
 * reads it as LOCAL time, so the "DST end day is 25 hours" test failed when the
 * process ran with TZ=America/New_York).
 */
export const BUSINESS_TZ = "America/New_York";

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of instant `date` in `tz` (month is 1-12), from Intl only. */
function wallClock(date: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const v: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type !== "literal") v[p.type] = Number(p.value);
  }
  // Some ICU builds still print midnight as "24" even with h23.
  return { y: v.year, mo: v.month, d: v.day, h: v.hour === 24 ? 0 : v.hour, mi: v.minute, s: v.second };
}

/**
 * Offset of `tz` from UTC at instant `date`, in ms (negative for ET).
 * Independent of the process time zone: the wall clock comes from Intl with an
 * explicit timeZone and is turned back into a number with Date.UTC.
 */
function tzOffsetMs(date: Date, tz: string): number {
  const w = wallClock(date, tz);
  const wallAsUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const instant = Math.floor(date.getTime() / 1000) * 1000; // parts carry no milliseconds
  return wallAsUtc - instant;
}

/** America/New_York offset from UTC at `date`, in ms (-5h EST, -4h EDT). */
export function etOffsetMs(date: Date): number {
  return tzOffsetMs(date, BUSINESS_TZ);
}

/**
 * Midnight ET, `daysAgo` days back from today. daysAgo=0 → today 00:00 ET,
 * 1 → yesterday 00:00 ET. Returned as a UTC instant.
 */
export function etMidnight(daysAgo: number, now: Date = new Date()): Date {
  // Today's ET calendar date, then midnight `daysAgo` days back, as
  // "ET wall-clock expressed as UTC" (Date.UTC normalises day underflow).
  const w = wallClock(now, BUSINESS_TZ);
  const wallMidnight = Date.UTC(w.y, w.mo - 1, w.d - daysAgo);
  // Resolve the offset AT the target instant so a DST change between `now`
  // and that midnight doesn't shift the boundary by an hour. Two refinement
  // passes are enough: ET changes offset at 02:00, never at midnight.
  let instant = wallMidnight - tzOffsetMs(now, BUSINESS_TZ);
  instant = wallMidnight - tzOffsetMs(new Date(instant), BUSINESS_TZ);
  instant = wallMidnight - tzOffsetMs(new Date(instant), BUSINESS_TZ);
  return new Date(instant);
}

/** The [from, to) window covering a whole ET day, `daysAgo` days back. */
export function etDayWindow(daysAgo: number, now: Date = new Date()): { from: Date; to: Date } {
  return { from: etMidnight(daysAgo, now), to: etMidnight(daysAgo - 1, now) };
}

/** "2026-08-19" for the ET day `daysAgo` days back — the heartbeat's day key. */
export function etDayKey(daysAgo: number, now: Date = new Date()): string {
  const d = etMidnight(daysAgo, now);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    // Ask for noon-ish rendering safety: the instant IS midnight ET, so the
    // date part is already the right day.
  }).format(new Date(d.getTime() + 60 * 60 * 1000));
}

/** "Wednesday, August 19, 2026" for the ET day `daysAgo` days back. */
export function etDayLabel(daysAgo: number, now: Date = new Date()): string {
  const d = etMidnight(daysAgo, now);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(d.getTime() + 60 * 60 * 1000));
}

/** "August 19, 2026" — subject-line form (platform-report-email convention). */
export function etDayShort(daysAgo: number, now: Date = new Date()): string {
  const d = etMidnight(daysAgo, now);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(d.getTime() + 60 * 60 * 1000));
}
