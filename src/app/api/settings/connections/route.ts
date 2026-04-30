export const runtime = 'edge';
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/settings/connections
 *
 * Returns the data the Settings page needs:
 *  - All CONNECTED platform connections (LinkedIn / Twitter / Google Business)
 *    grouped by platform, with which client they belong to.
 *  - Server-only "is OAuth configured" flags so the page can show whether
 *    LINKEDIN_CLIENT_ID / GOOGLE_CLIENT_ID env vars are set.
 *
 * Wraps in try/catch so failures come back as JSON instead of a Cloudflare
 * HTML error page (avoids the 1102 worker-error UX we were hitting on SSR).
 */
export async function GET() {
  try {
    const connections = await prisma.platformConnection.findMany({
      where: {
        platform: { in: ["LINKEDIN", "TWITTER", "GOOGLE_BUSINESS"] },
        connectionStatus: "CONNECTED",
      },
      select: {
        id: true,
        platform: true,
        externalAccountName: true,
        tokenExpiresAt: true,
        connectionStatus: true,
        tokenReference: true,
        client: { select: { id: true, name: true } },
      },
    });

    type ConnRow = {
      id: string;
      platform: string;
      externalAccountName: string | null;
      tokenExpiresAt: string | null;
      connectionStatus: string;
      hasToken: boolean;
      client: { id: string; name: string };
    };

    const byPlatform: Record<string, ConnRow[]> = {};
    for (const conn of connections) {
      const p = conn.platform;
      if (!byPlatform[p]) byPlatform[p] = [];
      byPlatform[p].push({
        id: conn.id,
        platform: conn.platform,
        externalAccountName: conn.externalAccountName,
        tokenExpiresAt: conn.tokenExpiresAt ? conn.tokenExpiresAt.toISOString() : null,
        connectionStatus: conn.connectionStatus,
        hasToken: !!conn.tokenReference,
        client: conn.client,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        connections: byPlatform,
        config: {
          linkedinConfigured: !!process.env.LINKEDIN_CLIENT_ID,
          linkedinSecretConfigured: !!process.env.LINKEDIN_CLIENT_SECRET,
          googleConfigured: !!process.env.GOOGLE_CLIENT_ID,
          googleSecretConfigured: !!process.env.GOOGLE_CLIENT_SECRET,
          appUrl: process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com",
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load settings";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
