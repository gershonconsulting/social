export const runtime = "edge";
/**
 * Copy newly collected posts from source companies into their mirrors in
 * other workspaces (see lib/workspaces/mirror.ts).
 *
 * Machine route: Authorization: Bearer <CRON_SECRET>. Called by the daily-sync
 * and health-check crons as a separate same-origin request, so it gets its own
 * Worker CPU budget.
 */
import { NextRequest, NextResponse } from "next/server";
import { syncMirrors } from "@/lib/workspaces/mirror";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncMirrors({ cap: 200 });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
