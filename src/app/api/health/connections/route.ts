export const runtime = 'edge';
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ConnectionStatus } from "@prisma/client";

/**
 * GET /api/health/connections
 *
 * Returns the *honest* per-platform health summary, plus a flat list of
 * connections that need attention (so a dashboard banner can link straight
 * to the offenders).
 *
 *   summary: { total, connected, expired, error, pending, disconnected }
 *   byPlatform: { LINKEDIN: { connected, expired, error, pending, total }, ... }
 *   needsAttention: [{ id, clientId, clientName, platform, status, lastSyncError }]
 *
 * 'connected' here means BOTH:
 *   - connectionStatus === CONNECTED, AND
 *   - has a token, AND
 *   - either has externalAccountId (proven discoverable) OR doesn't need one yet
 *
 * The point: never report 'all good' when sync would fail right now.
 */
export async function GET() {
  try {
    const conns = await prisma.platformConnection.findMany({
      where: {
        isEnabled: true,
        // Don't include unsupported platforms in the health summary — they're
        // legacy rows that will be cleaned up; counting them as 'broken'
        // pollutes the dashboard banner.
        platform: { in: ["LINKEDIN", "TWITTER", "GOOGLE_BUSINESS"] },
      },
      select: {
        id: true,
        platform: true,
        connectionStatus: true,
        tokenReference: true,
        externalAccountId: true,
        externalAccountUrl: true,
        lastSyncError: true,
        lastSyncAt: true,
        clientId: true,
        client: { select: { id: true, name: true, status: true } },
      },
    });

    // Filter out connections whose client is archived
    const active = conns.filter((c) => c.client?.status !== "ARCHIVED");

    type Counts = { connected: number; expired: number; error: number; pending: number; disconnected: number; total: number };
    const empty = (): Counts => ({ connected: 0, expired: 0, error: 0, pending: 0, disconnected: 0, total: 0 });

    const summary: Counts = empty();
    const byPlatform: Record<string, Counts> = {};
    const needsAttention: Array<{
      id: string;
      clientId: string;
      clientName: string;
      platform: string;
      status: string;
      lastSyncError: string | null;
      reason: string;
    }> = [];

    for (const c of active) {
      const platform = c.platform;
      if (!byPlatform[platform]) byPlatform[platform] = empty();
      byPlatform[platform].total++;
      summary.total++;

      // Determine the *honest* health: look at status + structural completeness
      const hasToken = !!c.tokenReference;
      const hasExtId = !!c.externalAccountId;
      let bucket: keyof Counts = "pending";
      let reason = "";

      if (c.connectionStatus === ConnectionStatus.CONNECTED) {
        if (!hasToken) {
          bucket = "pending";
          reason = "Status says CONNECTED but no token is stored.";
        } else if (!hasExtId) {
          bucket = "error";
          reason = "Token present but platform-specific ID is missing — sync can't run. Reconnect or fix the URL.";
        } else {
          bucket = "connected";
        }
      } else if (c.connectionStatus === ConnectionStatus.EXPIRED) {
        bucket = "expired";
        reason = c.lastSyncError || "Token expired — reconnect required.";
      } else if (c.connectionStatus === ConnectionStatus.ERROR) {
        bucket = "error";
        reason = c.lastSyncError || "Connection in ERROR state.";
      } else if (c.connectionStatus === ConnectionStatus.DISCONNECTED) {
        bucket = "disconnected";
        reason = "Disconnected.";
      } else if (c.connectionStatus === ConnectionStatus.PENDING) {
        bucket = "pending";
        reason = "Never authorized.";
      }

      byPlatform[platform][bucket]++;
      summary[bucket]++;

      if (bucket !== "connected") {
        needsAttention.push({
          id: c.id,
          clientId: c.clientId,
          clientName: c.client?.name ?? "?",
          platform,
          status: bucket.toUpperCase(),
          lastSyncError: c.lastSyncError,
          reason,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        summary,
        byPlatform,
        needsAttention,
        healthy: summary.connected === summary.total,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute connection health";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
