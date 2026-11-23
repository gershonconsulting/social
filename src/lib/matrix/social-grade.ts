/**
 * Social grading for the Client Platform Matrix / health.gershon.ai (Olivier, 2026-11-23):
 *
 *   RED    — fewer than 10 companies being watched for the client.
 *   ORANGE — 10+ companies, but content is not being collected continuously,
 *            so there is nothing to build intelligent reports from.
 *   GREEN  — 10+ companies AND collection runs all the time.
 *
 * "All the time" is measured, not assumed:
 *   - something new was collected in the last 48 hours, and
 *   - at least half of the watched companies had content collected in the last 14 days.
 *
 * Orange notes use the matrix engine's warning words ("never", "no scan"), so the
 * Client Platform Matrix renders them orange without any change on its side.
 */
export const MIN_COMPANIES = 10;
export const FRESH_HOURS = 48;
export const COVERAGE_DAYS = 14;
export const MIN_COVERAGE = 0.5;

export type SocialInput = {
  companies: number; // distinct companies watched for this client
  covered: number; // of those, how many had content collected in the last COVERAGE_DAYS
  posts30: number; // posts collected in the last 30 days across them
  lastCollectedAt: Date | null; // most recent collection across them
  now?: Date;
};
export type SocialGrade = { ok: boolean; warn: boolean; level: "red" | "orange" | "green"; note: string };

const ago = (d: Date, now: Date) => {
  const h = Math.max(0, Math.round((now.getTime() - d.getTime()) / 3600e3));
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function gradeSocial(x: SocialInput): SocialGrade {
  const now = x.now ?? new Date();
  const n = x.companies;
  const co = `${n} compan${n === 1 ? "y" : "ies"}`;
  if (n < MIN_COMPANIES) return { ok: false, warn: false, level: "red", note: `${co} watched (need ${MIN_COMPANIES})` };
  const fresh = !!x.lastCollectedAt && now.getTime() - x.lastCollectedAt.getTime() <= FRESH_HOURS * 3600e3;
  const coverage = x.covered / n;
  if (fresh && coverage >= MIN_COVERAGE) {
    return { ok: true, warn: false, level: "green", note: `${co} · ${x.posts30} posts (30d) · collecting` };
  }
  const why = !x.lastCollectedAt
    ? "never collected"
    : !fresh
      ? `no scan for ${ago(x.lastCollectedAt, now).replace(" ago", "")}`
      : `${n - x.covered} with no scan in ${COVERAGE_DAYS}d`;
  return { ok: true, warn: true, level: "orange", note: `${co} · ${why}` };
}
