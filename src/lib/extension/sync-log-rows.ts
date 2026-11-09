/** Pure half of sync-log.ts (no DB import) so it can be unit-tested. */

export const EXT_NOTE = "Chrome extension collection";

export interface IngestOutcome {
  clientId: string;
  platform: string;
  attempted: number;
  upserted: number;
  error?: string;
}

interface PlatformResult {
  platform: string;
  externalAccountName: string | null;
  postsUpserted: number;
  followerCount: number | null;
  success: boolean;
  error: string | null;
}

export interface SyncLogRow {
  jobType: "POST_SYNC";
  scopeType: "CLIENT";
  scopeId: string;
  clientId: string;
  organizationId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  startedAt: Date;
  finishedAt: Date;
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  resultsJson: string;
  errorLogJson: string | null;
  notes: string;
}

/** Pure: turn one ingest batch into one log row per company. */
export function buildSyncLogRows(
  orgId: string,
  outcomes: IngestOutcome[],
  startedAt: Date,
  finishedAt: Date,
  extVersion?: string | null,
): SyncLogRow[] {
  const byClient = new Map<string, IngestOutcome[]>();
  for (const o of outcomes) {
    // Rejected entries (bad payload, another workspace's company) have no
    // company of ours to log against.
    if (!o.clientId || o.clientId === "?" || o.error === "client not in this workspace") continue;
    const list = byClient.get(o.clientId) ?? [];
    list.push(o);
    byClient.set(o.clientId, list);
  }

  const note = extVersion ? `${EXT_NOTE} (extension v${extVersion})` : EXT_NOTE;
  const rows: SyncLogRow[] = [];
  for (const [clientId, list] of byClient) {
    const results: PlatformResult[] = list.map((o) => ({
      platform: o.platform,
      externalAccountName: null,
      postsUpserted: o.upserted,
      followerCount: null,
      success: !o.error,
      error: o.error ?? null,
    }));
    const failedCount = list.filter((o) => !!o.error).length;
    const status = failedCount === 0 ? "COMPLETED" : failedCount === list.length ? "FAILED" : "PARTIAL";
    const errors = list.filter((o) => o.error).map((o) => `${o.platform}: ${o.error}`);
    rows.push({
      jobType: "POST_SYNC",
      scopeType: "CLIENT",
      scopeId: clientId,
      clientId,
      organizationId: orgId,
      status,
      startedAt,
      finishedAt,
      itemsProcessed: list.reduce((s, o) => s + o.attempted, 0),
      itemsSucceeded: list.reduce((s, o) => s + o.upserted, 0),
      itemsFailed: failedCount,
      resultsJson: JSON.stringify(results),
      errorLogJson: errors.length ? JSON.stringify(errors) : null,
      notes: note,
    });
  }
  return rows;
}

