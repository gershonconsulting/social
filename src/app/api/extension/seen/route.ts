export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { EXTENSION_LATEST } from "@/lib/extension-version";
import { readExtSeen, recordExtSeen, semverLt } from "@/lib/extension/seen";

/**
 * GET  /api/extension/seen  — which extension version is installed, when it
 *                             was last seen, and whether it is out of date.
 * POST /api/extension/seen  — { version } heartbeat from the page bridge.
 *
 * Deliberately unauthenticated for POST: the dashboard is already behind a
 * session, the payload is a version string, and the worst a bad actor can do
 * is make the daily report nag about an upgrade.
 */
export async function GET() {
  try {
    const seen = await readExtSeen();
    return NextResponse.json({
      success: true,
      data: {
        installed: seen,
        latest: EXTENSION_LATEST,
        outOfDate: seen ? semverLt(seen.version, EXTENSION_LATEST) : null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "read failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { version?: string } | null;
    const version = (body?.version ?? "").trim();
    if (!/^\d+(\.\d+){0,3}$/.test(version)) {
      return NextResponse.json({ success: false, error: "valid version required" }, { status: 400 });
    }
    const next = await recordExtSeen(version);
    return NextResponse.json({
      success: true,
      data: { ...next, latest: EXTENSION_LATEST, outOfDate: semverLt(version, EXTENSION_LATEST) },
    });
  } catch (e) {
    // Never let a heartbeat failure surface as a page error.
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "heartbeat failed" },
      { status: 500 },
    );
  }
}
