export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getAdapter } from "@/lib/adapters/registry";
import { ConnectionStatus } from "@prisma/client";

/**
 * POST /api/platforms/[id]/test
 *
 * Actively probe a platform connection to verify the token still works.
 * Updates connectionStatus + lastSyncError based on the result so the UI
 * stops trusting stale "Connected" badges.
 *
 *  - hasToken false → PENDING (never authorized)
 *  - probe returns a value → CONNECTED, lastSyncError cleared
 *  - probe throws or returns null when a value is expected → EXPIRED with the
 *    error message captured in lastSyncError
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const conn = await prisma.platformConnection.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true, timezone: true } } },
    });
    if (!conn) {
      return NextResponse.json({ success: false, error: "Connection not found" }, { status: 404 });
    }

    const platformLabel = conn.platform;

    // For platforms that need OAuth, no token = PENDING. Twitter is an exception:
    // we read public profiles via syndication, so a missing token is fine — the
    // adapter just needs the @handle (resolved from the connection's URL).
    const platformsThatNeedToken = new Set(["LINKEDIN", "GOOGLE_BUSINESS"]);
    if (!conn.tokenReference && platformsThatNeedToken.has(conn.platform)) {
      await prisma.platformConnection.update({
        where: { id },
        data: {
          connectionStatus: ConnectionStatus.PENDING,
          lastSyncError: "No OAuth token on file. Reconnect from Settings.",
        },
      });
      return NextResponse.json({
        success: false,
        data: {
          status: "PENDING",
          platform: platformLabel,
          error: "No OAuth token on file. Reconnect from Settings.",
        },
      });
    }

    const adapter = getAdapter(conn.platform);
    if (!adapter) {
      await prisma.platformConnection.update({
        where: { id },
        data: {
          connectionStatus: ConnectionStatus.ERROR,
          lastSyncError: "No adapter implemented for this platform.",
        },
      });
      return NextResponse.json({
        success: false,
        data: {
          status: "ERROR",
          platform: platformLabel,
          error: "No adapter implemented for this platform.",
        },
      });
    }

    // Sanitize legacy Twitter {username,password} JSON: pass null instead so the
    // adapter doesn't choke on it. Twitter no longer needs a token at all.
    let tokenForAdapter: string | null = conn.tokenReference;
    if (conn.platform === "TWITTER" && tokenForAdapter) {
      try {
        const maybe = JSON.parse(tokenForAdapter);
        if (maybe && typeof maybe === "object" && ("username" in maybe || "password" in maybe)) {
          tokenForAdapter = null;
        }
      } catch {
        // not JSON — leave as is
      }
    }

    let probeError: string | null = null;
    let followerCount: number | null = null;
    try {
      followerCount = await adapter.fetchFollowerCount({
        platform: conn.platform,
        clientId: conn.clientId,
        connectionId: conn.id,
        externalAccountId: conn.externalAccountId ?? "",
        tokenReference: tokenForAdapter,
        timezone: conn.client?.timezone ?? "America/New_York",
      });
    } catch (e) {
      probeError = e instanceof Error ? e.message : String(e);
    }

    if (probeError) {
      // Heuristic: 401-ish errors → EXPIRED, anything else → ERROR
      const looksAuth = /401|unauthor|expired|invalid.?token/i.test(probeError);
      const newStatus = looksAuth ? ConnectionStatus.EXPIRED : ConnectionStatus.ERROR;
      await prisma.platformConnection.update({
        where: { id },
        data: { connectionStatus: newStatus, lastSyncError: probeError },
      });
      return NextResponse.json({
        success: false,
        data: { status: newStatus, platform: platformLabel, error: probeError },
      });
    }

    // No throw. If the adapter returned null (not all platforms expose follower
    // counts — e.g. Google Business returns null by design), we still consider
    // the call successful as long as it didn't throw.
    await prisma.platformConnection.update({
      where: { id },
      data: {
        connectionStatus: ConnectionStatus.CONNECTED,
        lastSyncError: null,
      },
    });
    return NextResponse.json({
      success: true,
      data: {
        status: "CONNECTED",
        platform: platformLabel,
        followerCount,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Test failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
