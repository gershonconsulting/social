/**
 * Ecosystem windows — v4.65.0.
 *
 * The five periods Olivier uses on every Gershon dashboard (Last week / Last
 * month / This month / This year / All time) and, for each, the PREVIOUS
 * comparable period, so "what changed" compares like with like:
 *
 *   lastWeek   last 7 days incl. today      vs the 7 days before
 *   lastMonth  previous calendar month      vs the month before that
 *   thisMonth  1st of this month → today    vs same days of last month
 *   thisYear   Jan 1 → today                vs same span last year
 *   allTime    everything                   (no comparison)
 *
 * Dates are publication dates (publishedDateLocal, YYYY-MM-DD), never import
 * time, and "today" is taken in America/New_York like the rest of Social.
 * Pure functions — no DB, no React — so they are unit-tested.
 */

export const WINDOW_KEYS = ["lastWeek", "lastMonth", "thisMonth", "thisYear", "allTime"] as const;
export type WindowKey = (typeof WINDOW_KEYS)[number];

export const WINDOW_LABELS: Record<WindowKey, string> = {
  lastWeek: "Last week",
  lastMonth: "Last month",
  thisMonth: "This month",
  thisYear: "This year",
  allTime: "All time",
};

export interface EcoWindow {
  key: WindowKey;
  from: string;
  to: string;
  /** Previous comparable period; null for All time. */
  prevFrom: string | null;
  prevTo: string | null;
}

export const DEFAULT_WINDOW: WindowKey = "thisMonth";

/** YYYY-MM-DD of `d` in America/New_York. */
export function nyDay(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}
function fmt(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return fmt(y, m, d + n);
}
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** All five windows for a given NY "today" (YYYY-MM-DD). */
export function ecoWindows(today: string): EcoWindow[] {
  const [y, m, d] = parts(today);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const ppm = pm === 1 ? 12 : pm - 1;
  const ppy = pm === 1 ? py - 1 : py;
  const prevSameDay = Math.min(d, lastDayOfMonth(py, pm));
  // Feb 29 → Feb 28 when last year was not a leap year.
  const lyDay = Math.min(d, lastDayOfMonth(y - 1, m));
  return [
    { key: "lastWeek", from: addDays(today, -6), to: today, prevFrom: addDays(today, -13), prevTo: addDays(today, -7) },
    {
      key: "lastMonth",
      from: fmt(py, pm, 1),
      to: fmt(py, pm, lastDayOfMonth(py, pm)),
      prevFrom: fmt(ppy, ppm, 1),
      prevTo: fmt(ppy, ppm, lastDayOfMonth(ppy, ppm)),
    },
    { key: "thisMonth", from: fmt(y, m, 1), to: today, prevFrom: fmt(py, pm, 1), prevTo: fmt(py, pm, prevSameDay) },
    { key: "thisYear", from: fmt(y, 1, 1), to: today, prevFrom: fmt(y - 1, 1, 1), prevTo: fmt(y - 1, m, lyDay) },
    { key: "allTime", from: "0000-01-01", to: today, prevFrom: null, prevTo: null },
  ];
}

/** Whole-number % change; null when there is no baseline to compare with. */
export function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** First non-empty line of a post, trimmed to `max` characters. */
export function firstLine(text: string | null | undefined, max = 140): string {
  const line = (text ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? line.slice(0, max - 1).trimEnd() + "…" : line;
}
