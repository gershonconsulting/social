export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { buildCampaignMonthlyReport, lastClosedMonth } from "@/lib/campaigns/monthly";
import { renderCompanyBody, renderSummaryBody, wrapEmail } from "@/lib/campaigns/render";
import { DEFAULT_TO, readSent, sendCampaignMonthlyReport } from "@/lib/campaigns/send";

/**
 * Month-end campaign report.
 *
 * GET                          → JSON preview of the numbers (never sends)
 * GET ?preview=email           → the summary document, as HTML
 * GET ?preview=email&slug=x    → one company's document, as HTML
 * POST (Bearer CRON_SECRET)    → sends the summary + one email per company
 *
 * Both verbs take ?month=YYYY-MM (default: the month that just closed).
 * POST also takes ?force=1 (resend a month already sent) and ?dry=1
 * (everything except the Resend call).
 *
 * The production trigger is the daily digest, which calls the same sender
 * on the 1st of the month; the idempotency record makes every later run a
 * no-op. See src/lib/campaigns/send.ts.
 */
function resolveMonth(req: NextRequest): string | null {
  const m = new URL(req.url).searchParams.get("month") || lastClosedMonth();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : null;
}

export async function GET(req: NextRequest) {
  try {
    const month = resolveMonth(req);
    if (!month) {
      return NextResponse.json({ success: false, error: "Invalid month. Use YYYY-MM." }, { status: 400 });
    }
    const { searchParams } = new URL(req.url);
    const preview = searchParams.get("preview");
    const slug = searchParams.get("slug");

    const report = await buildCampaignMonthlyReport(month);

    if (preview === "email") {
      if (slug) {
        const c = report.companies.find((x) => x.slug === slug);
        if (!c) {
          return NextResponse.json(
            { success: false, error: `No CAMPAIGN company with slug "${slug}"` },
            { status: 404 },
          );
        }
        return new NextResponse(wrapEmail(renderCompanyBody(report, c)), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new NextResponse(wrapEmail(renderSummaryBody(report)), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const sent = await readSent();
    return NextResponse.json({
      success: true,
      data: {
        month: report.month,
        monthLabel: report.monthLabel,
        totals: report.totals,
        companies: report.companies.map((c) => ({
          name: c.name,
          slug: c.slug,
          postsPublished: c.postsPublished,
          objectiveDays: c.objectiveDays,
          daysMet: c.daysMet,
          daysMissed: c.daysMissed,
          attainmentPct: c.attainmentPct,
          totalEngagement: c.totalEngagement,
          status: c.status,
          basis: c.basis,
          shareUrl: c.shareUrl,
        })),
        shareUrl: report.shareUrl,
        recipient: process.env.CAMPAIGN_REPORT_TO || DEFAULT_TO,
        alreadySent: sent[month] ?? null,
        previews: {
          summary: `/api/cron/campaign-monthly-report?preview=email&month=${month}`,
          perCompany: report.companies.map(
            (c) => `/api/cron/campaign-monthly-report?preview=email&month=${month}&slug=${c.slug}`,
          ),
        },
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "campaign monthly report failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const month = resolveMonth(req);
    if (!month) {
      return NextResponse.json({ success: false, error: "Invalid month. Use YYYY-MM." }, { status: 400 });
    }
    const { searchParams } = new URL(req.url);
    const out = await sendCampaignMonthlyReport({
      month,
      force: searchParams.get("force") === "1",
      dry: searchParams.get("dry") === "1",
    });
    return NextResponse.json({ success: true, data: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "campaign monthly send failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
