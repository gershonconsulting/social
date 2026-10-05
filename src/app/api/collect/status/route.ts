export const runtime = "edge";
/**
 * GET /api/collect/status — v4.29.0
 *
 * What a collector (Chrome extension, daily scrape routine) should bother
 * collecting for the caller's workspace. X / Twitter is `enabled: false`
 * when no working X credentials are in Settings — collectors skip X then.
 */
import { NextResponse } from "next/server";
import { requireOrgId } from "@/lib/competitors/store";
import { twitterCollectionEnabled, TWITTER_SKIPPED_REASON } from "@/lib/collect/twitter-gate";

export async function GET() {
  try {
    const orgId = await requireOrgId();
    const twitter = await twitterCollectionEnabled(orgId);
    return NextResponse.json({
      success: true,
      data: {
        twitter: { enabled: twitter, reason: twitter ? null : TWITTER_SKIPPED_REASON },
        linkedin: { enabled: true, reason: null },
        phantombuster: { enabled: false, reason: "Retired in v4.29.0" },
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "status failed" }, { status: 500 });
  }
}
