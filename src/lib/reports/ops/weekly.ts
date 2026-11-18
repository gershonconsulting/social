/**
 * v4.80.0 — Olivier 2026-11-18: "Let's make the client report weekly rather than daily."
 * Each client workspace's Competitive report goes out once a week, on Friday
 * (America/New_York), in line with the Friday client pack. Gershon's own daily
 * reports (Collection, Posting, Competitive, Intelligence) are unchanged.
 */
export const CLIENT_REPORT_WEEKDAY = "Fri";

/** Weekday (Mon..Sun) of a moment in New York time, independent of the machine TZ. */
export function etWeekday(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
}

/** True when today (ET) is the day the weekly client reports go out. */
export function isClientReportDay(d: Date = new Date()): boolean {
  return etWeekday(d) === CLIENT_REPORT_WEEKDAY;
}
