export const runtime = "edge";
/**
 * /api/cron/autopilot — Publishing Autopilot (v4.51.0). POST, Bearer CRON_SECRET.
 * Each call does a bounded amount of work for every workspace with Autopilot
 * on (auto-approve, schedule, rewrite, write ≤ 3 posts with pictures) and
 * answers { remaining }. .github/workflows/autopilot.yml calls it in a loop
 * until remaining is 0 — once a day, so the next month is complete on the 20th.
 * See lib/autopilot.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { autopilotOrgs, runStep } from "@/lib/autopilot";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || process.env.HEALTH_SECRET;
  if (!secret || (req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const out: Record<string, unknown> = {};
    let remaining = 0;
    for (const orgId of await autopilotOrgs()) {
      const r = await runStep(orgId, 3);
      // A call that could do nothing (AI down) must not loop the workflow all day.
      if (r.written || r.picturesFixed || r.revised) remaining += r.remaining;
      out[orgId] = r;
    }
    return NextResponse.json({ success: true, data: { remaining, workspaces: out } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
