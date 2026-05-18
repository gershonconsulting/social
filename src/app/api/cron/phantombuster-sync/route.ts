export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { runPhantombusterSync } from "@/lib/jobs/phantombuster-sync";

/**
 * GET /api/cron/phantombuster-sync
 *
 * Thin wrapper around runPhantombusterSync(). The actual sync logic lives
 * in src/lib/jobs/phantombuster-sync.ts so the daily-sync orchestrator can
 * call it as a fallback without going through HTTP.
 *
 * Auth policy: if an Authorization header is present, validate it against
 * CRON_SECRET (this is the cron-job path). If no Authorization header at
 * all, treat as a same-origin user-initiated request and allow.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (auth) {
      if (!secret || auth !== `Bearer ${secret}`) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const out = await runPhantombusterSync();
    if (!out.ok) {
      return NextResponse.json({ success: false, error: out.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: { results: out.results } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Phantombuster sync failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
