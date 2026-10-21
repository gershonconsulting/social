export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";


export async function GET(req: NextRequest) {

  try {
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
    // v4.59.0 audit: trends were taken from row positions (len-8 / len-31),
    // which is wrong whenever a day is missing, and two accounts on the same
    // network were mixed together. Now: per platformConnectionId, find the
    // latest snapshot on/before (latestDate - 7d) and (latestDate - 30d) by
    // DATE, then sum the connections per platform.
    const shiftDate = (ds: string, deltaDays: number) => {
      const d = new Date(`${ds}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + deltaDays);
      return d.toISOString().slice(0, 10);
    };
    const latestOnOrBefore = (sorted: typeof snapshots, ds: string) => {
      let found: (typeof snapshots)[number] | undefined;
      for (const s of sorted) {
        if (s.snapshotDateLocal <= ds) found = s;
        else break;
      }
      return found;
    };

    // Group by connection (one account = one series)
    const byConnection = new Map<string, typeof snapshots>();
    for (const snap of snapshots) {
      if (!byConnection.has(snap.platformConnectionId)) byConnection.set(snap.platformConnectionId, []);
      byConnection.get(snap.platformConnectionId)!.push(snap);
    }

    const latestByPlatform = new Map<
      string,
      { count: number; date: string; previous7?: number; previous30?: number }
    >();
    // Track whether every connection on a platform has a 7d / 30d baseline;
    // a partial sum would produce a fake jump, so drop the trend instead.
    const missing7 = new Set<string>();
    const missing30 = new Set<string>();

    for (const snaps of byConnection.values()) {
      const sorted = [...snaps].sort((a, b) => a.snapshotDateLocal.localeCompare(b.snapshotDateLocal));
      const latest = sorted[sorted.length - 1];
      const prev7 = latestOnOrBefore(sorted, shiftDate(latest.snapshotDateLocal, -7))?.followerCount;
      const prev30 = latestOnOrBefore(sorted, shiftDate(latest.snapshotDateLocal, -30))?.followerCount;

      const agg = latestByPlatform.get(latest.platform) ?? { count: 0, date: latest.snapshotDateLocal };
      agg.count += latest.followerCount;
      if (latest.snapshotDateLocal > agg.date) agg.date = latest.snapshotDateLocal;
      if (prev7 === undefined) missing7.add(latest.platform);
      else agg.previous7 = (agg.previous7 ?? 0) + prev7;
      if (prev30 === undefined) missing30.add(latest.platform);
      else agg.previous30 = (agg.previous30 ?? 0) + prev30;
      latestByPlatform.set(latest.platform, agg);
    }
    for (const [platform, agg] of latestByPlatform.entries()) {
      if (missing7.has(platform)) delete agg.previous7;
      if (missing30.has(platform)) delete agg.previous30;
    }

    const summary = Object.fromEntries(latestByPlatform.entries());

    return NextResponse.json({
      success: true,
      data: { snapshots, summary },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
