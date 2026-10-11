export const runtime = "edge";
/** GET /api/publishing/inventory — one week of approved content per client: live coverage + warnings (v4.39.0). */
import { NextResponse } from "next/server";
import { publishingCaller } from "@/lib/publishing-auth";
import { inventory, REVIEW_REMIND_AFTER_DAYS, TARGET_DAYS } from "@/lib/publishing-inventory";

export async function GET() {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  try {
    return NextResponse.json({ success: true, data: { rows: await inventory(c.orgId), targetDays: TARGET_DAYS, remindAfterDays: REVIEW_REMIND_AFTER_DAYS } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
