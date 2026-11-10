/**
 * Sync log entries for Chrome-extension collection (v4.74.0).
 *
 * WHY. The Logs page (/logs) lists SyncJob rows. Those used to be written by
 * the old server-side collectors (Phantombuster, cloud sync). Since collection
 * moved to the Chrome extension, /api/extension/ingest wrote posts and a
 * heartbeat but never a SyncJob — so the Logs page stopped showing any
 * collection at all, even though posts kept arriving.
 *
 * WHAT. Every ingest batch now writes one SyncJob per company it carried
 * (jobType POST_SYNC, scope CLIENT, notes start with EXT_NOTE), stamped with
 * the workspace so /api/jobs keeps showing each workspace only its own runs.
 * The per-platform results use the PlatformResult shape the Logs page already
 * renders. Rows older than KEEP_DAYS are pruned now and then so the table
 * stays small (Neon storage).
 *
 * Never throws: the posts are already written when this runs.
 */

import rawDb from "@/lib/db-raw";

import { buildSyncLogRows, EXT_NOTE, type IngestOutcome } from "./sync-log-rows";
export { EXT_NOTE, buildSyncLogRows } from "./sync-log-rows";

const KEEP_DAYS = 14;
const PRUNE_CHANCE = 0.05;

export async function recordExtensionSyncLog(
  orgId: string,
  outcomes: IngestOutcome[],
  startedAt: Date,
  extVersion?: string | null,
): Promise<void> {
  try {
    const rows = buildSyncLogRows(orgId, outcomes, startedAt, new Date(), extVersion);
    if (rows.length) await rawDb.syncJob.createMany({ data: rows });
  } catch {}
  if (Math.random() < PRUNE_CHANCE) {
    try {
      await rawDb.syncJob.deleteMany({
        where: {
          notes: { startsWith: EXT_NOTE },
          startedAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) },
        },
      });
    } catch {}
  }
}
