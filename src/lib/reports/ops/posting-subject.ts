/** Posting report subject + week number (v4.85.0). Kept DB-free so it can be unit-tested. */
/** ISO-8601 week number of a "YYYY-MM-DD" key (Mon–Sun weeks; a Sunday belongs to the week it ends). */
export function isoWeek(key: string): number {
  const d = new Date(`${key}T12:00:00Z`);
  const wd = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - wd); // Thursday of that week
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1) / 86400000 + 1) / 7);
}

/** Olivier 2026-11-23: "Social by Gershon.ai — Gershon Consulting — Master Posting report W46". */
export function postingSubject(r: { dayKey: string }, workspace?: string): string {
  const name = (workspace || "").trim() || "Gershon Consulting";
  return `Social by Gershon.ai — ${name} — Master Posting report W${isoWeek(r.dayKey)}`;
}
