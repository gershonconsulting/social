export const runtime = "edge";
/**
 * GET /api/collection-health — is LinkedIn collection broken for my workspace?
 * Feeds the red strip on every dashboard page (CollectionHealthBanner).
 * See lib/collection-health.ts.
 */
import { NextResponse } from "next/server";
import { orgFromSession } from "@/lib/session-org";
import { getLinkedInAlarm } from "@/lib/collection-health";

export async function GET() {
  try {
    const orgId = await orgFromSession();
    if (!orgId) return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    const linkedin = await getLinkedInAlarm(orgId);
    return NextResponse.json({ success: true, data: { linkedin } }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}
