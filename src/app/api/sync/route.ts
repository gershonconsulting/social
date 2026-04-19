export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { syncPlatformConnection, runBackfill, syncFollowerSnapshots } from "@/lib/jobs/sync";
import { recomputeClientCompliance } from "@/lib/compliance/engine";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { type, clientId, platformConnectionId, since, until } = body;

  if (!type) {
    return NextResponse.json({ success: false, error: "type is required" }, { status: 400 });
  }

  const sinceDate = since ? new Date(since) : new Date(new Date().setDate(new Date().getDate() - 7));
  const untilDate = until ? new Date(until) : new Date();

  switch (type) {
    case "platform": {
      if (!platformConnectionId) {
        return NextResponse.json({ success: false, error: "platformConnectionId is required" }, { status: 400 });
      }
      const result = await syncPlatformConnection(platformConnectionId, sinceDate, untilDate, null);
      return NextResponse.json({ success: result.success, data: result });
    }

    case "backfill": {
      if (!clientId) {
        return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
      }
      const result = await runBackfill(clientId, sinceDate, untilDate, null);
      return NextResponse.json({ success: result.success, data: result });
    }

    case "followers": {
      if (!clientId) {
        return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
      }
      await syncFollowerSnapshots(clientId);
      return NextResponse.json({ success: true, message: "Follower sync complete" });
    }

    case "recompute": {
      if (!clientId) {
        return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
      }
      const results = await recomputeClientCompliance(clientId, sinceDate, untilDate);
      return NextResponse.json({ success: true, data: results });
    }

    default:
      return NextResponse.json({ success: false, error: "Unknown sync type: " + type }, { status: 400 });
  }
}
