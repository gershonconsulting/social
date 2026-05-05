export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  authToken: z.string().min(20).max(200),
  ct0: z.string().min(20).max(200),
});

/**
 * POST /api/settings/twitter
 * Body: { authToken, ct0 }
 *
 * Stores X / Twitter session cookies on every Twitter platform connection.
 * Same auth your browser uses when you're logged in to x.com — the adapter
 * sends them as Cookie: auth_token=...; ct0=... + x-csrf-token: <ct0>.
 *
 * To get the values: log into x.com, open dev tools → Application → Cookies →
 * x.com, copy the Value for auth_token and ct0.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Both auth_token and ct0 cookies are required (20+ chars each).",
        },
        { status: 400 }
      );
    }

    const { authToken, ct0 } = parsed.data;
    const tokenRef = JSON.stringify({ authToken, ct0 });

    const conns = await prisma.platformConnection.findMany({ where: { platform: "TWITTER" } });
    if (conns.length === 0) {
      return NextResponse.json(
        { success: false, error: "No Twitter platform connections found. Add a client with Twitter first." },
        { status: 404 }
      );
    }

    await prisma.platformConnection.updateMany({
      where: { platform: "TWITTER" },
      data: {
        tokenReference: tokenRef,
        connectionStatus: "CONNECTED",
        lastSyncError: null,
        externalAccountId: null, // re-resolve user_id on next sync
      },
    });

    return NextResponse.json({
      success: true,
      message: `Session cookies saved on ${conns.length} Twitter connection(s). Run Sync Now on a client to fetch tweets.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save session";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
