export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

import { generateMonthlyReport, getAvailableMonths } from "@/lib/reports/monthly";

/**
 * GET /api/reports/monthly?clientId=X[&month=YYYY-MM]
 *
 * Without month: returns the list of months that have data for this client.
 *   - First tries DailyCompliance (the canonical source)
 *   - Falls back to SocialPost.publishedDateLocal if compliance is empty
 *     (e.g. compliance pipeline hasn't run yet) so the UI isn't stuck on
 *     an empty dropdown.
 *
 * With month: returns the full compliance report. Wraps generation in
 * try/catch so errors come back as JSON {success:false,error:string}
 * instead of a Cloudflare HTML error page — that lets the UI surface a
 * real message to the user.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");
    const month = searchParams.get("month"); // YYYY-MM

    if (!clientId) {
      return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
    }

    // No month → return available months
    if (!month) {
      let months = await getAvailableMonths(clientId);

      // Fallback: derive months from posts when DailyCompliance is empty.
      // This unblocks the Reports page when the compliance pipeline hasn't
      // computed anything yet (e.g. sync hasn't run).
      if (months.length === 0) {
        const postRecords = await prisma.socialPost.findMany({
          where: { clientId },
          select: { publishedDateLocal: true },
          distinct: ["publishedDateLocal"],
          orderBy: { publishedDateLocal: "desc" },
        });
        const uniq = new Set<string>();
        for (const r of postRecords) {
          if (r.publishedDateLocal) uniq.add(r.publishedDateLocal.slice(0, 7));
        }
        months = Array.from(uniq).sort().reverse();
      }

      return NextResponse.json({ success: true, data: months });
    }

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);

    if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
      return NextResponse.json(
        { success: false, error: "Invalid month format. Use YYYY-MM" },
        { status: 400 }
      );
    }

    const report = await generateMonthlyReport(clientId, year, monthNum);
    return NextResponse.json({ success: true, data: report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating report";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
