/**
 * Collection heartbeat — proof that the daily job actually ran.
 *
 * "No new posts yesterday" and "the collector never ran yesterday" look
 * identical in the SocialPost table, and they need very different reactions:
 * the first is a quiet day, the second is a broken pipeline. So every call to
 * /api/extension/ingest stamps a heartbeat here, whether or not it upserted
 * anything.
 *
 * Stored in the settings table (no schema change):
 *
 *   settings["collection_heartbeat"] = {
 *     lastAt: ISO,
 *     days: { "2026-08-19": { runs, attempted, upserted, failed }, ... }
 *   }
 *
 * Only the last KEEP_DAYS ET days are kept, so the row stays small.
 */

import prisma from "@/lib/db";
import { etDayKey } from "@/lib/reports/et-days";

export const HEARTBEAT_KEY = "collection_heartbeat";
const KEEP_DAYS = 21;

export interface HeartbeatDay {
  runs: number;
  attempted: number;
  upserted: number;
  failed: number;
}
export interface Heartbeat {
  lastAt: string | null;
  days: Record<string, HeartbeatDay>;
}

const EMPTY: Heartbeat = { lastAt: null, days: {} };

export async function readHeartbeat(): Promise<Heartbeat> {
  const row = await prisma.setting.findUnique({ where: { key: HEARTBEAT_KEY } });
  if (!row?.value) return EMPTY;
  try {
    const p = JSON.parse(row.value) as Partial<Heartbeat>;
    return {
      lastAt: typeof p.lastAt === "string" ? p.lastAt : null,
      days: p.days && typeof p.days === "object" ? (p.days as Record<string, HeartbeatDay>) : {},
    };
  } catch {
    return EMPTY;
  }
}

/** Fire-and-forget: never let a heartbeat failure fail the ingest response. */
export async function recordIngestRun(stats: {
  attempted: number;
  upserted: number;
  failed: number;
}): Promise<void> {
  try {
    const hb = await readHeartbeat();
    const key = etDayKey(0);
    const day = hb.days[key] ?? { runs: 0, attempted: 0, upserted: 0, failed: 0 };
    day.runs += 1;
    day.attempted += stats.attempted;
    day.upserted += stats.upserted;
    day.failed += stats.failed;
    hb.days[key] = day;
    hb.lastAt = new Date().toISOString();

    const keep = new Set<string>();
    for (let i = 0; i < KEEP_DAYS; i++) keep.add(etDayKey(i));
    for (const k of Object.keys(hb.days)) if (!keep.has(k)) delete hb.days[k];

    const value = JSON.stringify(hb);
    await prisma.setting.upsert({
      where: { key: HEARTBEAT_KEY },
      update: { value },
      create: { key: HEARTBEAT_KEY, value },
    });
  } catch {
    /* best-effort */
  }
}
