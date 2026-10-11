export const runtime = "edge";
/**
 * /api/cron/publishing-daily — every morning (v4.39.0):
 *   1. reminds each client's reviewer about posts waiting > 2 days;
 *   2. emails the team the content-inventory warnings (one week of approved
 *      content per client) and the overdue reviews — only when something
 *      needs attention, once a day.
 * POST, Bearer CRON_SECRET. ?force=1 resends today's team email.
 * Triggered by .github/workflows/publishing-daily.yml.
 */
import { NextRequest, NextResponse } from "next/server";
import { orgsForInventory, remindReviewers, teamDigest } from "@/lib/publishing-inventory";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || process.env.HEALTH_SECRET;
  if (!secret || (req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const out: Record<string, unknown> = {};
    for (const orgId of await orgsForInventory()) {
      const reminders = await remindReviewers(orgId);
      const digest = await teamDigest(orgId, Date.now(), force);
      out[orgId] = {
        reminders,
        teamEmail: digest.sent,
        warnings: digest.rows.filter((r) => r.level !== "ok").map((r) => ({ client: r.name, days: r.coverageDays, level: r.level })),
      };
    }
    return NextResponse.json({ success: true, data: out });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
