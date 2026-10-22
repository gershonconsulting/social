/**
 * Is the collector healthy? — judged from FAILED collection attempts.
 *
 * Audit 2026-10-22: the 20 Oct Social Collection Report said "✓ System
 * healthy" while its own scorecard showed 155 failed collection attempts
 * (+812% on the day before, +344% on the 7-day average). Posts were flowing,
 * so the old rule (posts > 0 and not far under average) said healthy.
 *
 * Rule (pure, unit-tested in tests/report-logic.test.ts). `failed` is the
 * heartbeat's per-company scrape failures for the day:
 *
 *   baseline = average of the 7 days BEFORE the reported day
 *              (falls back to the day before when there is no history)
 *
 *   DEGRADED when either
 *     a) failed >= FAIL_MAX (50)                — too many, whatever the trend
 *     b) failed >= SPIKE_FACTOR (2) × baseline  — a spike, and
 *        failed - baseline >= SPIKE_MIN_DELTA (20) — big enough to matter
 *
 *   otherwise HEALTHY. `null` failures (no heartbeat that day) = unknown, which
 *   leaves the existing post-count verdict untouched.
 *
 * Thresholds are deliberately simple; change them here only.
 */

export const FAIL_MAX = 50;
export const SPIKE_FACTOR = 2;
export const SPIKE_MIN_DELTA = 20;

export interface FailureHealth {
  level: "ok" | "degraded" | "unknown";
  failed: number | null;
  baseline: number | null;
  /** Rounded % change vs baseline, null when baseline is 0 or unknown. */
  changePct: number | null;
  reason: string;
}

export function failureHealth(input: {
  failed: number | null;
  /** Failures on the days BEFORE the reported day (most recent first). */
  previous: Array<number | null>;
}): FailureHealth {
  const { failed } = input;
  const known = input.previous.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const week = known.slice(0, 7);
  const baseline = week.length > 0 ? week.reduce((s, v) => s + v, 0) / week.length : null;
  const changePct = failed !== null && baseline !== null && baseline > 0 ? Math.round(((failed - baseline) / baseline) * 100) : null;

  if (failed === null) {
    return { level: "unknown", failed, baseline, changePct, reason: "no collection heartbeat for the day" };
  }
  if (failed >= FAIL_MAX) {
    return { level: "degraded", failed, baseline, changePct, reason: `${failed} failed attempts (limit ${FAIL_MAX})` };
  }
  if (baseline !== null && failed >= SPIKE_FACTOR * baseline && failed - baseline >= SPIKE_MIN_DELTA) {
    return { level: "degraded", failed, baseline, changePct, reason: `${failed} failed attempts, ${SPIKE_FACTOR}× or more the usual ${Math.round(baseline)}` };
  }
  return { level: "ok", failed, baseline, changePct, reason: "failures within the normal range" };
}

/** "155 failed collection attempts (+344% vs 7-day average)" */
export function failureLine(h: FailureHealth): string {
  const n = h.failed ?? 0;
  const base = `${n} failed collection ${n === 1 ? "attempt" : "attempts"}`;
  if (h.changePct === null) return base;
  const sign = h.changePct >= 0 ? "+" : "−";
  return `${base} (${sign}${Math.abs(h.changePct)}% vs the usual ${Math.round(h.baseline ?? 0)})`;
}
