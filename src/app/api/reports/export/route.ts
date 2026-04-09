export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";
import { generateMonthlyReport } from "@/lib/reports/monthly";
import { reportToCSV } from "@/lib/reports/export";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  let user: { id?: string };
  try {
    user = await requireRole(UserRole.OPERATIONS);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const month = searchParams.get("month");
  const format = searchParams.get("format") ?? "csv";

  if (!clientId || !month) {
    return NextResponse.json({ success: false, error: "clientId and month are required" }, { status: 400 });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);

  const report = await generateMonthlyReport(clientId, year, monthNum);

  // Audit the export
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id ?? null,
      actionType: "REPORT_EXPORTED",
      entityType: "Client",
      entityId: clientId,
      afterJson: JSON.stringify({ format, month }),
    },
  });

  if (format === "csv") {
    const csv = reportToCSV(report);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="compliance-${report.clientName}-${month}.csv"`,
      },
    });
  }

  // For PDF: return the structured report data and let the client render it
  // (jsPDF runs in the browser)
  return NextResponse.json({ success: true, data: report });
}
