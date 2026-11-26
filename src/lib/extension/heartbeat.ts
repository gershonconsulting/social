/**
 * Collection heartbeat — proof that the daily job actually ran.
 *
 * "No new posts yesterday" and "the collector never ran yesterday" look
 * identical in the SocialPost table, and they need very different reactions:
 * the first is a quiet day, the second is a broken pipeline. So every call to
 * /api/extension/ingest stamps a heartbeat here, whether or not it upserted
 * anything.
 *
 * Stored (no schema change):
 *
 *   orgSetting[org, "collection_heartbeat"]  — per workspace (v4.87.1)
 *   setting["collection_heartbeat"]          — all workspaces together (legacy)
 *     = { lastAt: ISO, since?: ISO,
 *         days: { "2026-08-19": { runs, attempted, upserted, failed, failedKeys? }, ... } }
 *
 * Only the last KEEP_DAYS ET days are kept, so the rows stay small.
 * Pure parts live in ./heartbeat-core (tested).
 */

import prisma from "@/lib/db";
import rawPrisma from "@/lib/db-raw";
import { etDayKey } from "@/lib/reports/et-days";
import { etDayOf } from "@/lib/reports/collection-day";
import { addRun, parseHeartbeat, pickHeartbeat, type Heartbeat } from "./heartbeat-core";

export type { Heartbeat, HeartbeatDay } from "./heartbeat-core";
export { failedProfiles } from "./heartbeat-core";

export const HEARTBEAT_KEY = "collection_heartbeat";
const KEEP_DAYS = 21;

async function readGlobal(): Promise<Heartbeat> {
  const row = await prisma.setting.findUnique({ where: { key: HEARTBEAT_KEY } });
  return parseHeartbeat(row?.value);
}

async function readOrg(orgId: string): Promise<Heartbeat> {
  const row = await rawPrisma.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: HEARTBEAT_KEY } },
  });
  return parseHeartbeat(row?.value);
}

/**
 * The heartbeat of one workspace (default: the primary one, Gershon — the
 * reports that read it are Gershon's): its own runs only, falling back to the
 * all-workspace row for days before the workspace row existed.
 */
export async function readHeartbeat(orgId?: string): Promise<Heartbeat> {
  try {
    const id = orgId ?? (await rawPrisma.organization.findFirst({ where: { isPrimary: true }, select: { id: true } }))?.id;
    if (!id) return await readGlobal();
    const [org, global] = await Promise.all([readOrg(id), readGlobal()]);
    return pickHeartbeat(org, global, etDayOf);
  } catch {
    return parseHeartbeat(null);
  }
}

function keepKeys(): Set<string> {
  const keep = new Set<string>();
  for (let i = 0; i < KEEP_DAYS; i++) keep.add(etDayKey(i));
  return keep;
}

/** All-workspace row. Fire-and-forget: never let a heartbeat failure fail the ingest response. */
export async function recordIngestRun(stats: {
  attempted: number;
  upserted: number;
  failed: number;
}): Promise<void> {
  try {
    const hb = addRun(await readGlobal(), etDayKey(0), stats, new Date().toISOString(), keepKeys());
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

/**
 * Per-workspace row (v4.87.1), from the per-company outcomes of one ingest
 * batch (the same list the sync log is written from): one run, its attempts,
 * upserts, failures, and the distinct profiles that failed. Never throws.
 */
export async function recordOrgIngestRun(
  orgId: string,
  outcomes: Array<{ clientId: string; platform: string; attempted: number; upserted: number; error?: string }>,
): Promise<void> {
  try {
    const failedOnes = outcomes.filter((o) => o.error);
    const stats = {
      attempted: outcomes.reduce((s, o) => s + (Number(o.attempted) || 0), 0),
      upserted: outcomes.reduce((s, o) => s + (Number(o.upserted) || 0), 0),
      failed: failedOnes.length,
      failedKeys: failedOnes.map((o) => `${o.clientId}|${o.platform}`),
    };
    const hb = addRun(await readOrg(orgId), etDayKey(0), stats, new Date().toISOString(), keepKeys());
    const value = JSON.stringify(hb);
    await rawPrisma.orgSetting.upsert({
      where: { organizationId_key: { organizationId: orgId, key: HEARTBEAT_KEY } },
      update: { value },
      create: { organizationId: orgId, key: HEARTBEAT_KEY, value },
    });
  } catch {
    /* best-effort */
  }
}
