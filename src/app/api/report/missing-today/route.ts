export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { buildMissingToday, missingSubject, nyHour, renderMissingHtml, sendMissingToday } from "@/lib/reports/missing-today";

/**
 * [19] Social — still missing today (replaces Claude task #19).
 *
 * POST /api/report/missing-today            — build AND send (Resend) if N > 0
 *        ?nyHour=9                          — only send when it is that hour in New York
 *                                             (the workflow fires at 13:00 and 14:00 UTC so
 *                                             one of them is 09:00 NY in both EDT and EST)
 *        ?force=1                           — send even if today's email already went out
 *        ?to=addr                           — override recipient (tests)
 * GET  /api/report/missing-today?key=…      — preview (HTML; ?format=json for data), never sends
 *
 * Auth: Bearer CRON_SECRET / DIGEST_SECRET (POST); GET needs the same secret as ?key= or Bearer.
 */
function authed(req: NextRequest): boolean {
  const secrets = [process.env.CRON_SECRET, process.env.DIGEST_SECRET].filter((s): s is string => !!s && s.length >= 8);
  if (secrets.length === 0) return false;
  const auth = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return secrets.some((s) => auth === `Bearer ${s}` || key === s);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const r = await buildMissingToday();
    if (new URL(req.url).searchParams.get("format") === "json") {
      return NextResponse.json({ success: true, data: { subject: missingSubject(r), ...r } }, { headers: { "Cache-Control": "no-store" } });
    }
    return new NextResponse(renderMissingHtml(r), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const want = url.searchParams.get("nyHour");
    if (want !== null && Number(want) !== nyHour()) {
      return NextResponse.json({ success: true, data: { sent: false, skipped: `not ${want}:00 in New York (now ${nyHour()}:xx)` } });
    }
    const r = await sendMissingToday({
      force: url.searchParams.get("force") === "1",
      to: url.searchParams.get("to") || undefined,
    });
    return NextResponse.json({ success: !r.error, data: r }, { status: r.error ? 502 : 200 });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
