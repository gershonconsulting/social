export const runtime = "edge";
/**
 * /api/cron/publish-sweep — the server-side check that scheduled LinkedIn and
 * X posts really went out (v4.37.0). POST, Bearer CRON_SECRET. Runs every 15
 * minutes from .github/workflows/publish-sweep.yml; see sweep() in
 * lib/publishing.ts. The backstop for when the publishing browser is off.
 */
import { NextRequest, NextResponse } from "next/server";
import { orgsWithDeliveries, sweep } from "@/lib/publishing";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || process.env.HEALTH_SECRET;
  if (!secret || (req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const orgs = await orgsWithDeliveries();
    const results: Record<string, unknown> = {};
    for (const o of orgs) results[o] = await sweep(o);
    return NextResponse.json({ success: true, data: { workspaces: orgs.length, results } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
