export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { buildDailyReport } from "@/lib/reports/daily-report";
import { renderDailyReportHtml, dailyReportSubject } from "@/lib/reports/daily-report-render";
import { sendDailyReport } from "@/lib/reports/daily-report-send";

/**
 * GET  /api/report/daily              — render the email in the browser (never sends)
 * GET  /api/report/daily?format=json  — the raw numbers behind it
 * POST /api/report/daily              — build AND send via Resend
 *        ?force=1                     — send even if today's report already went out
 *
 * Auth (POST only): Bearer CRON_SECRET or DIGEST_SECRET — same secret the
 * daily digest and health check use, so no new secret to provision.
 * Recipient: REPORT_TO, defaulting to report@gershonconsulting.com per the
 * platform-report-email convention.
 */
export async function GET(req: NextRequest) {
  try {
    const format = new URL(req.url).searchParams.get("format");
    const report = await buildDailyReport();
    if (format === "json") {
      return NextResponse.json({
        success: true,
        data: { subject: dailyReportSubject(report), report },
      });
    }
    return new NextResponse(renderDailyReportHtml(report), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "report build failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const to = url.searchParams.get("to") || undefined;
    const r = await sendDailyReport({ force, to });
    return NextResponse.json(
      {
        success: r.sent || r.skipped !== null,
        data: {
          day: r.dayKey,
          subject: r.subject,
          to: r.to,
          sent: r.sent,
          skipped: r.skipped,
          status: r.status,
          error: r.error,
          statusLevel: r.report.status.level,
          extensionLevel: r.report.extension.level,
          progress: r.report.progress,
        },
      },
      { status: r.sent || r.skipped ? 200 : 502 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "report send failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
