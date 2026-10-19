export const runtime = "edge";
/**
 * /api/publishing/autopilot (v4.51.0)
 *   GET  → status: the month being prepared, per company progress, settings.
 *   PUT  → settings { enabled?, clientIds?, postTime?, autoApproveHours?, monthDay? }.
 *   POST { action: "run" } → one Autopilot step now (the page calls it until remaining = 0).
 */
import { NextRequest, NextResponse } from "next/server";
import { publishingCaller } from "@/lib/publishing-auth";
import { runStep, saveAutopilotSettings, status, type AutopilotSettings } from "@/lib/autopilot";

export async function GET() {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  try {
    return NextResponse.json({ success: true, data: await status(c.orgId) });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  try {
    const b = ((await req.json().catch(() => null)) || {}) as Partial<AutopilotSettings>;
    const patch: Partial<AutopilotSettings> = {};
    if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
    if (b.clientIds === null || Array.isArray(b.clientIds)) patch.clientIds = b.clientIds;
    if (typeof b.postTime === "string") patch.postTime = b.postTime;
    if (b.autoApproveHours !== undefined) patch.autoApproveHours = Number(b.autoApproveHours);
    if (b.monthDay !== undefined) patch.monthDay = Number(b.monthDay);
    await saveAutopilotSettings(c.orgId, patch);
    return NextResponse.json({ success: true, data: await status(c.orgId) });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  try {
    const b = ((await req.json().catch(() => null)) || {}) as { action?: string };
    if (b.action !== "run") return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    const r = await runStep(c.orgId, 2);
    return NextResponse.json({ success: true, data: r });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
