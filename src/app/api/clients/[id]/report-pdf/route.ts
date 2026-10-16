export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { buildCompanyPdf, CompanyReportError } from "@/lib/reports/monthly/company-download";

/**
 * GET /api/clients/<id>/report-pdf[?month=YYYY-MM]   — v4.47.0
 *
 * The one-page monthly report for ONE company, any category, as a PDF
 * download. Default month: the current one, to date. Session-only (middleware)
 * and tenant-scoped (lib/db), like every /api/clients route.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const month = new URL(req.url).searchParams.get("month");
    const { pdf, filename } = await buildCompanyPdf(id, month);
    return new NextResponse(pdf.bytes() as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const status = e instanceof CompanyReportError ? e.status : 500;
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "PDF build failed" }, { status });
  }
}
