export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/compliance/batch?from=2026-01-01&to=2026-04-20
 *
 * Returns posting compliance for ALL active clients over an arbitrary date range.
 * Each client gets: overall %, per-platform %, working days, days with posts.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  // Default: current month
  const from = fromParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = toParam || todayStr;

  // Cap "to" at today
  const effectiveTo = to > todayStr ? todayStr : to;

  // Get all active clients with their connections
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    include: {
      platformConnections: {
        where: { isEnabled: true },
        select: { platform: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const clientIds = clients.map((c) => c.id);

  // Get all posts in the date range for all clients
  const posts = await prisma.socialPost.findMany({
    where: {
      clientId: { in: clientIds },
      publishedDateLocal: { gte: from, lte: effectiveTo },
    },
    select: {
      clientId: true,
      platform: true,
      publishedDateLocal: true,
    },
  });

  // Build a lookup: clientId -> platform -> Set of dates
  const postLookup: Record<string, Record<string, Set<string>>> = {};
  for (const p of posts) {
    if (!postLookup[p.clientId]) postLookup[p.clientId] = {};
    if (!postLookup[p.clientId][p.platform]) postLookup[p.clientId][p.platform] = new Set();
    postLookup[p.clientId][p.platform].add(p.publishedDateLocal);
  }

  // Calculate working days in the range
  const workingDays: string[] = [];
  const startDate = new Date(from + "T00:00:00Z");
  const endDate = new Date(effectiveTo + "T00:00:00Z");

  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      const ds = d.toISOString().split("T")[0];
      workingDays.push(ds);
    }
  }

  const totalWorkingDays = workingDays.length;

  // Compute compliance for each client
  const results = clients.map((client) => {
    const trackedPlatforms = client.platformConnections.map((c) => c.platform);
    const clientPosts = postLookup[client.id] || {};

    // Per-platform compliance
    const platforms = trackedPlatforms.map((platform) => {
      const datesWithPosts = clientPosts[platform] || new Set<string>();
      const daysWithPosts = workingDays.filter((d) => datesWithPosts.has(d)).length;
      const percentage = totalWorkingDays > 0
        ? Math.round((daysWithPosts / totalWorkingDays) * 100)
        : 0;
      return { platform, daysWithPosts, totalWorkingDays, percentage };
    });

    // Overall: at least one post on any tracked platform on that working day
    const overallDaysWithPosts = workingDays.filter((d) =>
      trackedPlatforms.some((p) => (clientPosts[p] || new Set()).has(d))
    ).length;
    const overallPercentage = totalWorkingDays > 0
      ? Math.round((overallDaysWithPosts / totalWorkingDays) * 100)
      : 0;

    return {
      clientId: client.id,
      clientName: client.name,
      clientType: client.clientType,
      overall: { daysWithPosts: overallDaysWithPosts, totalWorkingDays, percentage: overallPercentage },
      platforms,
    };
  });

  return NextResponse.json({
    success: true,
    data: {
      from,
      to: effectiveTo,
      totalWorkingDays,
      clients: results,
    },
  });
}
