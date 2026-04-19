export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function GET(req: NextRequest) {

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
