export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    await requireRole(UserRole.OPERATIONS);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const platform = searchParams.get("platform");

  if (!clientId) {
    return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
  }

  const where: Record<string, unknown> = { clientId };
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, string> = {};
    if (dateFrom) dateFilter.gte = dateFrom;
    if (dateTo) dateFilter.lte = dateTo;
    where.dateLocal = dateFilter;
  }
  if (platform) where.platform = platform;

  const records = await prisma.dailyCompliance.findMany({
    where,
    orderBy: [{ dateLocal: "desc" }, { platform: "asc" }],
    include: {
      platformConnection: {
        select: { externalAccountName: true, externalAccountUrl: true },
      },
    },
  });

  return NextResponse.json({ success: true, data: records });
}
