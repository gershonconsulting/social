export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  li_at: z.string().min(20).max(500),
  JSESSIONID: z.string().min(10).max(200),
});

/**
 * POST /api/settings/linkedin
 * Body: { li_at, JSESSIONID }
 *
 * Saves LinkedIn session cookies on every LinkedIn platform connection.
 * The adapter then uses these cookies to call linkedin.com's Voyager API
 * (the same internal API the web frontend uses), bypassing the locked-down
 * OAuth Marketing API path.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Both li_at (20+ chars) and JSESSIONID (10+ chars) are required." },
        { status: 400 }
      );
    }

    const { li_at, JSESSIONID } = parsed.data;
    const tokenRef = JSON.stringify({ li_at, JSESSIONID });

    const conns = await prisma.platformConnection.findMany({ where: { platform: "LINKEDIN" } });
    if (conns.length === 0) {
      return NextResponse.json(
        { success: false, error: "No LinkedIn platform connections found. Add a client with LinkedIn first." },
        { status: 404 }
      );
    }

    await prisma.platformConnection.updateMany({
      where: { platform: "LINKEDIN" },
      data: {
        tokenReference: tokenRef,
        connectionStatus: "CONNECTED",
        lastSyncError: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Session cookies saved on ${conns.length} LinkedIn connection(s). Run Sync Now on a client to fetch posts.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save LinkedIn session";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
