export const runtime = "edge";
/**
 * GET /api/collect/queue[?id=<job>]  (signed-in dashboard)
 *
 * The background-collection queue: recent jobs, and every Chrome that has
 * checked in (extension version, last check-in, whether it is listening now).
 * With ?id= the matching job is also returned on its own as `job`.
 */
import { NextRequest, NextResponse } from "next/server";
import { orgFromSession } from "@/lib/session-org";
import { queueStatus } from "@/lib/remote-collect";

export async function GET(req: NextRequest) {
  const orgId = await orgFromSession();
  if (!orgId) return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  try {
    const view = await queueStatus(orgId);
    const id = req.nextUrl.searchParams.get("id");
    const job = id ? view.jobs.find((j) => j.id === id) || null : undefined;
    return NextResponse.json({ success: true, data: { ...view, job } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
