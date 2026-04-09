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
  const platform = searchParams.get("platform");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!clientId) {
    return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
  }

  const where: Record<string, unknown> = { clientId };
  if (platform) where.platform = platform;
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, string> = {};
    if (dateFrom) dateFilter.gte = dateFrom;
    if (dateTo) dateFilter.lte = dateTo;
    where.snapshotDateLocal = dateFilter;
  }

  const snapshots = await prisma.followerSnapshot.findMany({
    where,
    orderBy: [{ snapshotDateLocal: "asc" }, { platform: "asc" }],
    include: {
      platformConnection: {
        select: { externalAccountName: true },
      },
    },
  });

  // Build summary: latest count + trends
  const latestByPlatform = new Map<
    string,
    { count: number; date: string; previous7?: number; previous30?: number }
  >();

  // Group by platform
  const byPlatform = new Map<string, typeof snapshots>();
  for (const snap of snapshots) {
    if (!byPlatform.has(snap.platform)) byPlatform.set(snap.platform, []);
    byPlatform.get(snap.platform)!.push(snap);
  }

  for (const [platform, snaps] of byPlatform.entries()) {
    const sorted = snaps.sort((a, b) => a.snapshotDateLocal.localeCompare(b.snapshotDateLocal));
    const latest = sorted[sorted.length - 1];
    const prev7 = sorted[sorted.length - 8]?.followerCount;
    const prev30 = sorted[sorted.length - 31]?.followerCount;

    latestByPlatform.set(platform, {
      count: latest.followerCount,
      date: latest.snapshotDateLocal,
      previous7: prev7,
      previous30: prev30,
    });
  }

  const summary = Object.fromEntries(latestByPlatform.entries());

  return NextResponse.json({
    success: true,
    data: { snapshots, summary },
  });
}
