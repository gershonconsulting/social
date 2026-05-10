export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getPbConfig, fetchContainer } from "@/lib/phantombuster";

/**
 * GET /api/phantombuster/check?containerId=<id>
 *
 * Returns per-container status (the actual run we just launched), not the
 * stale agent-level "lastEndType". A run is ready to import when status is
 * "finished" AND exitCode === 0. exitCode 1 typically means the phantom's
 * saved sessionCookie has expired and needs refreshing in the PB UI.
 */
export async function GET(req: NextRequest) {
  try {
    const containerId = req.nextUrl.searchParams.get("containerId");
    if (!containerId) {
      return NextResponse.json({ success: false, error: "containerId is required" }, { status: 400 });
    }
    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: "Phantombuster is not configured." }, { status: 400 });
    }
    const c = await fetchContainer(config.apiKey, containerId);
    return NextResponse.json({
      success: true,
      data: {
        containerId,
        status: c.status,           // "running" | "finished" | etc.
        exitCode: c.exitCode,       // 0 = ok, non-zero = error (often expired cookie)
        endType: c.endType,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Check failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
