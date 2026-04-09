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
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  const jobs = await prisma.syncJob.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: {
      triggeredBy: { select: { name: true, email: true } },
      client: { select: { name: true, slug: true } },
    },
  });

  return NextResponse.json({ success: true, data: jobs });
}
