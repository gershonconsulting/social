/**
 * v4.83.0: which companies can have a Competitor Watch.
 *
 * v4.35.0 limited it to the workspace's own company (INTERNAL). Since the
 * Friday client pack (v4.78.0) reads each client's Competitor Watch links,
 * Gershon's campaign clients and clients need it too (Olivier, 2026-11-23).
 * Their competitors are filed as COMPETITION companies of this workspace,
 * noted "Competitor of <client>".
 */
export const WATCHABLE_TYPES = ["INTERNAL", "CAMPAIGN", "CLIENT"] as const;

export function canWatchCompetitors(clientType: string | null | undefined): boolean {
  return !!clientType && (WATCHABLE_TYPES as readonly string[]).includes(clientType);
}
