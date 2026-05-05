export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";

const twitterSchema = z.object({
  bearerToken: z.string().min(20).max(500),
});

/**
 * POST /api/settings/twitter
 * Body: { bearerToken: "AAAAAA..." }
 *
 * Stores the bearer token on every Twitter platform connection. The same
 * token works across all of Olivier's tracked X / Twitter accounts because
 * the Twitter v2 API uses the bearer token to identify the *requesting app*,
 * not the target account — target is identified by user_id (which the
 * adapter looks up from the @username on first sync).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = twitterSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Bearer token is required (20+ chars). Get it from your Twitter Developer Portal project.",
        },
        { status: 400 }
      );
    }

    const { bearerToken } = parsed.data;

    const twitterConnections = await prisma.platformConnection.findMany({
      where: { platform: "TWITTER" },
    });

    if (twitterConnections.length === 0) {
      return NextResponse.json(
        { success: false, error: "No Twitter platform connections found. Add a client with Twitter first." },
        { status: 404 }
      );
    }

    // Distribute the bearer token to every Twitter connection. Clear stale
    // externalAccountId/lastSyncError so the next sync re-runs user_id discovery.
    await prisma.platformConnection.updateMany({
      where: { platform: "TWITTER" },
      data: {
        tokenReference: bearerToken,
        connectionStatus: "CONNECTED",
        lastSyncError: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Bearer token saved on ${twitterConnections.length} Twitter connection(s).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save token";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
