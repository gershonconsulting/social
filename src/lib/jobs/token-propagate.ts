/**
 * Token propagation helper.
 *
 * Olivier's case: a new company is added (e.g. SelectUSA). Its platform
 * connections are inserted in PENDING with no token. Other companies on the
 * same platform already have a valid OAuth token. Without manual intervention,
 * the new connection sits PENDING forever — the OAuth callback only updateMany's
 * existing rows at the moment it runs.
 *
 * This helper finds a fresh token for a platform and copies it onto every
 * tokenless PENDING connection of that platform, flipping them to CONNECTED.
 * Idempotent and safe to call repeatedly.
 */

import prisma from "@/lib/db";
import { ConnectionStatus, Platform } from "@prisma/client";

export interface PropagateResult {
  platform: Platform;
  appliedTo: number;
  skipped: "no-source-token" | "no-pending" | null;
  sourceConnectionId: string | null;
}

async function propagateOne(platform: Platform): Promise<PropagateResult> {
  // 1. Find a usable source token: any connection on this platform that has
  //    a tokenReference and isn't expired (we treat null tokenExpiresAt as still
  //    valid because Twitter username/password auth doesn't have an expiry).
  const source = await prisma.platformConnection.findFirst({
    where: {
      platform,
      tokenReference: { not: null },
      connectionStatus: ConnectionStatus.CONNECTED,
    },
    orderBy: { tokenExpiresAt: "desc" },
  });
  if (!source || !source.tokenReference) {
    return { platform, appliedTo: 0, skipped: "no-source-token", sourceConnectionId: null };
  }

  // 2. Copy onto pending rows for the same platform that don't have a token.
  const result = await prisma.platformConnection.updateMany({
    where: {
      platform,
      tokenReference: null,
      connectionStatus: { in: [ConnectionStatus.PENDING, ConnectionStatus.DISCONNECTED] },
    },
    data: {
      tokenReference: source.tokenReference,
      tokenExpiresAt: source.tokenExpiresAt,
      connectionStatus: ConnectionStatus.CONNECTED,
      lastSyncError: null,
    },
  });

  return {
    platform,
    appliedTo: result.count,
    skipped: result.count === 0 ? "no-pending" : null,
    sourceConnectionId: source.id,
  };
}

/**
 * Propagate tokens for a single platform.
 */
export async function propagateTokensForPlatform(platform: Platform): Promise<PropagateResult> {
  return propagateOne(platform);
}

/**
 * Propagate tokens for every platform that has at least one CONNECTED row.
 * Returns one result per platform processed.
 */
export async function propagateTokensForAllPlatforms(): Promise<PropagateResult[]> {
  const distinctPlatforms = await prisma.platformConnection.findMany({
    where: { connectionStatus: ConnectionStatus.CONNECTED, tokenReference: { not: null } },
    distinct: ["platform"],
    select: { platform: true },
  });
  const out: PropagateResult[] = [];
  for (const p of distinctPlatforms) {
    out.push(await propagateOne(p.platform));
  }
  return out;
}
