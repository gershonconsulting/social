export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import {
  buildCampaignMonthlyReport,
  lastClosedMonth,
  resolveToken,
} from "@/lib/campaigns/monthly";
import { renderCompanyBody, renderSummaryBody, wrapPage } from "@/lib/campaigns/render";
import raw from "@/lib/db-raw";
import { primaryOrgId } from "@/lib/reports/monthly/data";

/**
 * GET /r/<token>[?month=YYYY-MM]
 *
 * The single link. A token resolves to either "all" (every campaign
 * company) or one clientId (that company only). Tokens are permanent, so
 * the same link keeps working every month — by default it shows the month
 * that just closed, and ?month= walks back through history.
 *
 * Deliberately a route handler, not a page: this renders one self-contained
 * HTML document with a print stylesheet (that's the PDF path — Workers have
 * no PDF engine), and React SSR with Prisma on this project has a history of
 * tripping the Cloudflare 1102 resource limit.
 *
 * Unlisted-URL security: possession of the token is the authorization.
 * noindex is set, and an unknown token gets a generic 404 page — no hint
 * about whether the token ever existed.
 */

function notFound(): NextResponse {
  return new NextResponse(
    wrapPage(
      "Report not found",
      `<div style="padding:48px 24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="font-size:20px;font-weight:800;color:#111827;">Report not found</div>
        <div style="font-size:14px;color:#6b7280;margin-top:8px;">This link is not valid. Ask Gershon Consulting for a current one.</div>
      </div>`,
    ),
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    if (!token || !/^[a-f0-9]{16,48}$/.test(token)) return notFound();

    const scope = await resolveToken(token);
    if (!scope) return notFound();

    // v4.59.0 audit: tokens carry no organization — they are Gershon's share
    // links — so pin them to the primary (Gershon) org the same way the
    // /api/report/* machine routes do, using the raw client so the answer does
    // not depend on who (or whether anyone) is signed in when the link opens.
    const orgId = await primaryOrgId();
    if (scope !== "all") {
      const owned = await raw.client.findFirst({
        where: { id: scope, organizationId: orgId },
        select: { id: true },
      });
      if (!owned) return notFound();
    }

    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") || lastClosedMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return notFound();

    if (scope === "all") {
      const report = await buildCampaignMonthlyReport(month, { orgId });
      return new NextResponse(
        wrapPage(`Campaign performance — ${report.monthLabel}`, renderSummaryBody(report)),
        {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, max-age=300",
            "X-Robots-Tag": "noindex, nofollow",
          },
        },
      );
    }

    const report = await buildCampaignMonthlyReport(month, { clientId: scope, orgId });
    const company = report.companies[0];
    // The company was archived or moved out of CAMPAIGN since the token was
    // issued — the link is real but there is nothing to show.
    if (!company) return notFound();

    return new NextResponse(
      wrapPage(`${company.name} — ${report.monthLabel}`, renderCompanyBody(report, company)),
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, max-age=300",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "report render failed";
    return new NextResponse(
      wrapPage(
        "Report unavailable",
        `<div style="padding:48px 24px;text-align:center;font-family:-apple-system,sans-serif;">
          <div style="font-size:20px;font-weight:800;color:#111827;">Report temporarily unavailable</div>
          <div style="font-size:13px;color:#6b7280;margin-top:8px;">${msg.replace(/</g, "&lt;")}</div>
        </div>`,
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
