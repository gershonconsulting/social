export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType } from "@prisma/client";
import {
  buildCampaignMonthlyReport,
  lastClosedMonth,
  REPORT_API_VERSION,
} from "@/lib/campaigns/monthly";

/**
 * GET /api/campaigns/monthly
 *
 * The machine-readable half of the campaign monthly report — five key data
 * points per CAMPAIGN company, for consumption by the other gershonCRM
 * platforms (client / dash / roi / pulse).
 *
 *   month=YYYY-MM   default: the month that just closed
 *   slug=<slug>     restrict to one company
 *   detail=full     include missed dates, best post, per-platform split
 *
 * The five data points, per company:
 *   postsPublished · objectiveDays · daysMet · daysMissed · attainmentPct
 * Each company also carries `previous` (the same five for the prior month)
 * and a permanent `shareUrl` — the human-readable version of the same data.
 *
 * Auth: X-API-Key, matched against CAMPAIGN_API_KEY (falls back to
 * TEST_API_KEY). Same key as /api/campaigns/attainment, deliberately —
 * one key for the campaign surface. Keep it server-side; never call this
 * from a browser.
 *
 * Scope is fixed to clientType=CAMPAIGN. There is no parameter to widen
 * it: this endpoint exists to report on campaign commitments, and letting
 * a caller pull PROSPECT or INTERNAL companies through it would make the
 * numbers mean something different depending on who asked.
 */
export async function GET(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = process.env.CAMPAIGN_API_KEY || process.env.TEST_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { success: false, error: "CAMPAIGN_API_KEY not configured on this environment" },
      { status: 503 },
    );
  }
  if (!provided || provided !== expected) {
    return NextResponse.json({ success: false, error: "Invalid or missing X-API-Key" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || lastClosedMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json(
        { success: false, error: "Invalid month. Use YYYY-MM." },
        { status: 400 },
      );
    }
    const slug = searchParams.get("slug");
    const full = searchParams.get("detail") === "full";

    let clientId: string | undefined;
    if (slug) {
      const c = await prisma.client.findUnique({ where: { slug }, select: { id: true, clientType: true, status: true } });
      if (!c) {
        return NextResponse.json({ success: false, error: `No company with slug "${slug}"` }, { status: 404 });
      }
      if (c.clientType !== ClientType.CAMPAIGN || c.status === ClientStatus.ARCHIVED) {
        return NextResponse.json(
          { success: false, error: `"${slug}" is not an active CAMPAIGN company — this endpoint only reports on campaigns` },
          { status: 404 },
        );
      }
      clientId = c.id;
    }

    const report = await buildCampaignMonthlyReport(month, { clientId });

    const companies = report.companies.map((c) => {
      const lean = {
        slug: c.slug,
        name: c.name,
        // ── the five key data points ──
        postsPublished: c.postsPublished,
        objectiveDays: c.objectiveDays,
        daysMet: c.daysMet,
        daysMissed: c.daysMissed,
        attainmentPct: c.attainmentPct,
        // ── context ──
        totalEngagement: c.totalEngagement,
        status: c.status,
        basis: c.basis,
        previous: c.previous,
        shareUrl: c.shareUrl,
      };
      if (!full) return lean;
      return {
        ...lean,
        engagementBreakdown: c.engagementBreakdown,
        platforms: c.platforms,
        missedDates: c.missedDates,
        bestPost: c.bestPost,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        apiVersion: REPORT_API_VERSION,
        month: report.month,
        monthLabel: report.monthLabel,
        previousMonth: report.previousMonth,
        generatedAt: report.generatedAt,
        objective: report.objective,
        scope: report.scope,
        basisNote:
          "A day counts as met when at least one tracked platform published that day. basis=compliance means verified from DailyCompliance; basis=derived means the objective was inferred from the posting schedule because compliance has not been computed for that month.",
        totals: report.totals,
        companies,
        shareUrl: report.shareUrl,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "campaign monthly report failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
