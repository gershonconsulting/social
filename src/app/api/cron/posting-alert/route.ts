export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { buildPostingAlert, type PeriodKind } from "@/lib/alerts/posting-alerts";
import { renderAlertBody, wrapAlertEmail, alertSubject } from "@/lib/alerts/render";
import { sendPostingAlert, dueAlerts } from "@/lib/alerts/send";

/**
 * Posting alert — "tell me when the content did not go out as planned".
 *
 * Scope: clientType = CAMPAIGN, not archived. Objective: one post per planned
 * day, measured at company-day level. Recipient: POSTING_ALERT_TO, default
 * social@gershonconsulting.com. SILENT when every company hit every day.
 *
 * ROUTES
 *   GET  ?kind=week|month                  — JSON preview of the computed alert
 *                                            (read-only, NEVER sends).
 *   GET  ?kind=week&preview=email          — render the email HTML for QA.
 *   POST                                   — send whatever is due right now
 *                                            (Friday evening → week, 1st → month).
 *   POST ?kind=week[&force=1]              — send that one explicitly. `force=1`
 *                                            ignores the idempotency record and
 *                                            `dry=1` computes without sending.
 *
 * AUTH (POST only): Authorization: Bearer <CRON_SECRET | DIGEST_SECRET | HEALTH_SECRET>
 *
 * SCHEDULE: .github/workflows/posting-alert.yml — Fridays 21:00 UTC (17:00 ET)
 * and the 1st of each month. If that workflow file is not installed, the daily
 * digest calls the same sender over the weekend / on the 1st as a fallback;
 * both paths share one idempotency record so neither can double-send.
 */

function parseKind(v: string | null): PeriodKind | null {
  return v === "week" || v === "month" ? v : null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = parseKind(url.searchParams.get("kind")) ?? "week";
    const alert = await buildPostingAlert(kind);

    if (url.searchParams.get("preview") === "email") {
      // Always render, even when healthy, so the layout can be checked.
      const html = wrapAlertEmail(renderAlertBody(alert));
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return NextResponse.json({
      success: true,
      wouldSend: !alert.healthy,
      subject: alert.healthy ? null : alertSubject(alert),
      recipient: process.env.POSTING_ALERT_TO || "social@gershonconsulting.com",
      dueNow: dueAlerts(),
      data: alert,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "posting alert build failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || process.env.HEALTH_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const dry = url.searchParams.get("dry") === "1";
    const explicit = parseKind(url.searchParams.get("kind"));
    const kinds: PeriodKind[] = explicit ? [explicit] : dueAlerts();

    if (kinds.length === 0) {
      return NextResponse.json({
        success: true,
        action: "skip",
        reason: "nothing due at this time (week fires Fri 20:00 UTC onward, month on the 1st)",
        sent: 0,
      });
    }

    const results = [];
    for (const kind of kinds) {
      results.push(await sendPostingAlert({ kind, force, dry }));
    }

    return NextResponse.json({
      success: true,
      sent: results.reduce((s, r) => s + r.sent, 0),
      results: results.map((r) => ({
        kind: r.kind,
        periodKey: r.periodKey,
        sent: r.sent,
        skipped: r.skipped,
        companiesOffTarget: r.companiesOffTarget,
        recipient: r.recipient,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "posting alert send failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
