export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";

import { generateMonthlyReport, getAvailableMonths } from "@/lib/reports/monthly";

export async function GET(req: NextRequest) {

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const month = searchParams.get("month"); // YYYY-MM

  if (!clientId) {
    return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
  }

  // If no month specified, return list of available months
  if (!month) {
    const months = await getAvailableMonths(clientId);
    return NextResponse.json({ success: true, data: months });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);

  if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
    return NextResponse.json({ success: false, error: "Invalid month format. Use YYYY-MM" }, { status: 400 });
  }

  const report = await generateMonthlyReport(clientId, year, monthNum);

  return NextResponse.json({ success: true, data: report });
}
