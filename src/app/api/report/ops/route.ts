export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { buildOps, isOpsKind, OPS_KINDS, sendOps } from "@/lib/reports/ops";

/**
 * The daily operations reports (v4.49.0) — each one its own email to
 * report@gershonconsulting.com, next to the Collection report (/api/report/daily):
 *
 *   ?kind=posting      did every campaign / internal company post?
 *   ?kind=content      approved content ready to publish, per company
 *   ?kind=competitive  competitor & partner posts collected per day / week, and what they are about
 *   ?kind=intelligence AI insights + actions from competitor & partner posts — goes to sales@ (v4.50.0)
 *                      GET &refresh=1 re-runs the AI instead of using today's cached answer
 *
 * GET  ?kind=…               render that email in the browser (never sends)
 * GET  ?kind=…&format=json   the numbers behind it
 * POST                       build AND send all three (or ?kind=… for one)
 *        ?force=1            resend even if today's already went out
 *        ?to=a@b.c           send to another address (testing)
 * POST auth: Bearer CRON_SECRET | DIGEST_SECRET (same as the daily report).
 * Sent every morning by the daily report cron (POST /api/report/daily chains here).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (!isOpsKind(kind)) {
    return NextResponse.json({ success: false, error: `kind must be one of: ${OPS_KINDS.join(", ")}` }, { status: 400 });
  }
  try {
    const b = await buildOps(kind, undefined, { refresh: url.searchParams.get("refresh") === "1" });
    if (url.searchParams.get("format") === "json") {
      return NextResponse.json({ success: true, data: { subject: b.subject, day: b.dayKey, report: b.data } });
    }
    return new NextResponse(b.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "report build failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET;
  if (!secret || (req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  try {
    const results = await sendOps({
      kinds: isOpsKind(kind) ? [kind] : undefined,
      force: url.searchParams.get("force") === "1",
      to: url.searchParams.get("to") || undefined,
    });
    const ok = results.every((r) => r.sent || ("skipped" in r && r.skipped));
    return NextResponse.json({ success: ok, data: results }, { status: ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "report send failed" }, { status: 500 });
  }
}
