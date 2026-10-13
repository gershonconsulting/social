export const runtime = "edge";
/**
 * GET /api/extension/collect/next?agent=<install id>&v=<version>&label=<browser>
 * (extension workspace token)
 *
 * Called by every bound extension once a minute (0.19.0+). Records that this
 * install is listening, and hands it the oldest waiting collection request,
 * claimed so no other browser gets it.  → { job: { id, clientId } | null }
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionCaller } from "@/lib/extension-auth";
import { claimNext } from "@/lib/remote-collect";

export async function GET(req: NextRequest) {
  const caller = await resolveExtensionCaller(req);
  if (!caller.ok) {
    return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
  }
  const p = req.nextUrl.searchParams;
  const agentId = (p.get("agent") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  if (!agentId) return NextResponse.json({ success: false, error: "agent required" }, { status: 400 });
  const agent = {
    id: agentId,
    version: (p.get("v") || "?").slice(0, 20),
    label: (p.get("label") || "Chrome").slice(0, 60),
  };
  try {
    const job = await claimNext(caller.orgId, agent);
    return NextResponse.json({
      success: true,
      data: { job: job ? { id: job.id, clientId: job.clientId, clientName: job.clientName } : null },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
