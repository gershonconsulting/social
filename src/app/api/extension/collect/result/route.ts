export const runtime = "edge";
/**
 * POST /api/extension/collect/result  (extension workspace token)
 * body: { id, agent, ok, totalUpserted, totalFailed, accountCount, errors[] }
 *
 * The browser that claimed a background collection reports how it went.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionCaller } from "@/lib/extension-auth";
import { reportResult } from "@/lib/remote-collect";

export async function POST(req: NextRequest) {
  const caller = await resolveExtensionCaller(req);
  if (!caller.ok) {
    return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
  }
  try {
    const b = await req.json();
    const job = await reportResult(caller.orgId, String(b?.id || ""), String(b?.agent || ""), {
      ok: !!b?.ok,
      upserted: b?.totalUpserted,
      failed: b?.totalFailed,
      accounts: b?.accountCount,
      errors: Array.isArray(b?.errors) ? b.errors : [],
    });
    if (!job) return NextResponse.json({ success: false, error: "Unknown job, or not claimed by this browser" }, { status: 404 });
    return NextResponse.json({ success: true, data: { job } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
