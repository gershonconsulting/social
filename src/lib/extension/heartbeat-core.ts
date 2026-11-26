/**
 * Pure helpers for the collection heartbeat (no DB import, so tests can load them).
 *
 * v4.87.1 (nightly 2026-11-26). Two counting faults in "Failed collection
 * attempts" of the daily brief:
 *
 *  1. The heartbeat was ONE global row for every workspace. Since v4.86.0 moved
 *     competitors into the clients' own workspaces, the collectors of those
 *     workspaces ingest too, and their runs / failures landed in the Gershon
 *     brief (which counts posts for Gershon's companies only). Each workspace now
 *     has its own heartbeat (OrgSetting); the global row is still written so
 *     older readers keep working.
 *  2. "failed" adds one per company per RUN: a company whose link is dead fails
 *     in every one of the day's 13 runs and counts 13. The day now also keeps
 *     the distinct profiles that failed, so the brief can say "51 failed
 *     attempts · 9 profiles".
 */

export interface HeartbeatDay {
  runs: number;
  attempted: number;
  upserted: number;
  failed: number;
  /** v4.87.1: distinct profiles (connection ids) that failed at least once that day. */
  failedKeys?: string[];
}
export interface Heartbeat {
  lastAt: string | null;
  /** v4.87.1: when this (per-workspace) heartbeat was first written. */
  since?: string | null;
  days: Record<string, HeartbeatDay>;
}

export const MAX_FAILED_KEYS = 500;

export function emptyHeartbeat(): Heartbeat {
  return { lastAt: null, days: {} };
}

export function parseHeartbeat(raw: string | null | undefined): Heartbeat {
  if (!raw) return emptyHeartbeat();
  try {
    const p = JSON.parse(raw) as Partial<Heartbeat>;
    return {
      lastAt: typeof p.lastAt === "string" ? p.lastAt : null,
      ...(typeof p.since === "string" ? { since: p.since } : {}),
      days: p.days && typeof p.days === "object" ? (p.days as Record<string, HeartbeatDay>) : {},
    };
  } catch {
    return emptyHeartbeat();
  }
}

/** Add one ingest run to day `key` (mutates and returns hb). */
export function addRun(
  hb: Heartbeat,
  key: string,
  stats: { attempted: number; upserted: number; failed: number; failedKeys?: string[] },
  nowIso: string,
  keepKeys?: Set<string>,
): Heartbeat {
  const day: HeartbeatDay = hb.days[key] ?? { runs: 0, attempted: 0, upserted: 0, failed: 0 };
  day.runs += 1;
  day.attempted += stats.attempted;
  day.upserted += stats.upserted;
  day.failed += stats.failed;
  if (stats.failedKeys && stats.failedKeys.length) {
    const set = new Set(day.failedKeys ?? []);
    for (const k of stats.failedKeys) {
      if (set.size >= MAX_FAILED_KEYS) break;
      if (k) set.add(k);
    }
    day.failedKeys = Array.from(set);
  }
  hb.days[key] = day;
  hb.lastAt = nowIso;
  if (!hb.since) hb.since = nowIso;
  if (keepKeys) for (const k of Object.keys(hb.days)) if (!keepKeys.has(k)) delete hb.days[k];
  return hb;
}

/**
 * The heartbeat a workspace's reports should read: its own days; the global
 * row only for days before the workspace heartbeat existed (and for the day it
 * started, which the workspace row holds only partly).
 */
export function pickHeartbeat(org: Heartbeat, global: Heartbeat, dayOf: (iso: string) => string): Heartbeat {
  const startDay = org.since ? dayOf(org.since) : null;
  const days: Record<string, HeartbeatDay> = {};
  for (const [k, v] of Object.entries(global.days)) {
    if (!startDay || k <= startDay) days[k] = v;
  }
  for (const [k, v] of Object.entries(org.days)) {
    if (startDay && k === startDay && global.days[k]) continue;
    days[k] = v;
  }
  return { lastAt: org.lastAt ?? global.lastAt, ...(org.since ? { since: org.since } : {}), days };
}

/** Distinct failed profiles for a day, or null when the day predates v4.87.1. */
export function failedProfiles(day: HeartbeatDay | undefined | null): number | null {
  return day && Array.isArray(day.failedKeys) ? day.failedKeys.length : null;
}
