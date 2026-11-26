/**
 * Which connections the Collection section of a workspace's daily brief may
 * list (pure, tested).
 *
 * v4.87.1 (nightly 2026-11-26): "Connections in error" and "LinkedIn links to
 * fix" queried every workspace's connections. The report runs from cron with
 * no session, so the database client is the unscoped one; after v4.86.0 moved
 * competitors into the clients' own workspaces, the Gershon brief listed their
 * errors (The Integer Group, Mars United Commerce, Geometry Global, The Green
 * Shot …) even though the digest — already scoped — did not. Both lists are
 * now limited to the workspace the brief is about, like the digest.
 */

export function errorConnectionsWhere(orgId: string) {
  return {
    isEnabled: true,
    lastSyncError: { not: null },
    client: { organizationId: orgId },
  };
}

export function pageProblemsWhere(orgId: string) {
  return {
    isEnabled: true,
    platform: "LINKEDIN" as const,
    client: { organizationId: orgId },
    OR: [
      { lastSyncError: { startsWith: "PAGE_UNAVAILABLE" } },
      { lastSyncError: { startsWith: "PAGE_MISMATCH" } },
    ],
  };
}

/**
 * Hint under "Failed collection attempts". The number counts one per company
 * per RUN (a dead link fails in each of the day's runs), so say so, and give
 * the distinct profiles when the heartbeat has them.
 */
export function failedHint(profiles: number | null): string {
  const base = "company scrapes that failed, counted once per run";
  if (profiles === null) return base;
  return `${base} · ${profiles} distinct profile${profiles === 1 ? "" : "s"}`;
}
