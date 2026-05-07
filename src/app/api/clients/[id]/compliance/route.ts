export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/clients/[id]/compliance?month=2026-03
 *
 * Computes posting compliance from socialPosts data.
 * Returns per-platform breakdown: working days, days with posts, percentage,
 * and a day-by-day calendar with hasPost + isWorkingDay flags.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const { id } = await params;
  const url = request.nextUrl;
  const monthParam = url.searchParams.get("month"); // YYYY-MM

  // Default to current month
  const now = new Date();
  const [year, month] = monthParam
    ? monthParam.split("-").map(Number)
    : [now.getFullYear(), now.getMonth() + 1];

  // Calculate date range for the month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  // Determine today's date string for capping the calendar
  const todayStr = now.toISOString().split("T")[0];

  // Get all posts for this client in the month
  const posts = await prisma.socialPost.findMany({
    where: {
      clientId: id,
      publishedDateLocal: { gte: startDate, lte: endDate },
    },
    select: {
      platform: true,
      publishedDateLocal: true,
      postUrl: true,
      postTextSnippet: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
    },
  });

  // Get client's platform connections
  const connections = await prisma.platformConnection.findMany({
    where: { clientId: id, isEnabled: true },
    select: { platform: true, externalAccountName: true },
  });

  const trackedPlatforms = connections.map((c) => c.platform);

  // Build calendar: every day in the month (up to today if current month)
  const calendar: Array<{
    date: string;
    dayOfWeek: number;
    isWorkingDay: boolean;
    platforms: Record<string, { hasPost: boolean; postCount: number }>;
  }> = [];

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    // Don't include future dates
    if (dateStr > todayStr) break;

    const dateObj = new Date(year, month - 1, d);
    const dow = dateObj.getDay(); // 0=Sun, 6=Sat
    const isWorkingDay = dow >= 1 && dow <= 5;

    const platformData: Record<string, { hasPost: boolean; postCount: number }> = {};
    for (const p of trackedPlatforms) {
      const dayPosts = posts.filter(
        (post) => post.publishedDateLocal === dateStr && post.platform === p
      );
      platformData[p] = {
        hasPost: dayPosts.length > 0,
        postCount: dayPosts.length,
      };
    }

    calendar.push({ date: dateStr, dayOfWeek: dow, isWorkingDay, platforms: platformData });
  }

  // Calculate compliance per platform
  const workingDays = calendar.filter((d) => d.isWorkingDay);
  const totalWorkingDays = workingDays.length;

  const platformCompliance = trackedPlatforms.map((platform) => {
    const daysWithPosts = workingDays.filter(
      (d) => d.platforms[platform]?.hasPost
    ).length;
    const percentage = totalWorkingDays > 0
      ? Math.round((daysWithPosts / totalWorkingDays) * 100)
      : 0;
    const connName = connections.find((c) => c.platform === platform)?.externalAccountName;

    return {
      platform,
      label: connName || platform,
      daysWithPosts,
      totalWorkingDays,
      percentage,
    };
  });

  // Overall: at least one post on any tracked platform
  const overallDaysWithPosts = workingDays.filter((d) =>
    trackedPlatforms.some((p) => d.platforms[p]?.hasPost)
  ).length;
  const overallPercentage = totalWorkingDays > 0
    ? Math.round((overallDaysWithPosts / totalWorkingDays) * 100)
    : 0;

  return NextResponse.json({
    success: true,
    data: {
      month: `${year}-${String(month).padStart(2, "0")}`,
      totalWorkingDays,
      overall: {
        daysWithPosts: overallDaysWithPosts,
        totalWorkingDays,
        percentage: overallPercentage,
      },
      platforms: platformCompliance,
      calendar,
    },
  });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute compliance";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
