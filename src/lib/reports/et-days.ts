/**
 * Day boundaries in the business timezone (America/New_York).
 *
 * "Yesterday" in the daily report means yesterday as Olivier lived it, not a
 * rolling 24h window and not a UTC day — a report that lands at 8am ET must
 * cover 00:00–23:59 ET of the previous calendar day.
 *
 * Edge runtime has full ICU, so Intl is available; Date arithmetic is done by
 * shifting into "ET wall-clock expressed as UTC" and back.
 */
export const BUSINESS_TZ = "America/New_York";

/** Offset of `tz` from UTC at instant `date`, in ms (negative for ET). */
function tzOffsetMs(date: Date, tz: string): number {
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const loc = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  return loc.getTime() - utc.getTime();
}

/**
 * Midnight ET, `daysAgo` days back from today. daysAgo=0 → today 00:00 ET,
 * 1 → yesterday 00:00 ET. Returned as a UTC instant.
 */
export function etMidnight(daysAgo: number, now: Date = new Date()): Date {
  const off = tzOffsetMs(now, BUSINESS_TZ);
  const shifted = new Date(now.getTime() + off);
  const ms = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysAgo);
  // Re-resolve the offset at the target instant so a DST change mid-window
  // doesn't shift the boundary by an hour.
  const approx = new Date(ms - off);
  return new Date(ms - tzOffsetMs(approx, BUSINESS_TZ));
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
