export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/clients/[id]/posts?months=2&platform=LINKEDIN
 *
 * Returns posts for a client, optionally filtered by platform and date range.
 * Used by the listing view and calendar view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {

  const { id } = await params;
  const url = request.nextUrl;
  const months = parseInt(url.searchParams.get("months") || "2", 10);
  const platform = url.searchParams.get("platform") || undefined;

  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = {
    clientId: id,
    publishedAtUtc: { gte: since },
  };
  if (platform) {
    where.platform = platform;
  }

  const posts = await prisma.socialPost.findMany({
    where,
    orderBy: { publishedAtUtc: "desc" },
    select: {
      id: true,
      platform: true,
      externalPostId: true,
      postUrl: true,
      postTextSnippet: true,
      hasMedia: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      publishedAtUtc: true,
      publishedDateLocal: true,
    },
  });

  // Build calendar data: group by date
  const calendarMap = new Map<string, { hasPost: boolean; postCount: number }>();
  const now = new Date();
  for (let d = new Date(since); d <= now; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    calendarMap.set(dateStr, { hasPost: false, postCount: 0 });
  }
  for (const post of posts) {
    const dateStr = post.publishedDateLocal;
    if (calendarMap.has(dateStr)) {
      calendarMap.set(dateStr, { hasPost: true, postCount: (calendarMap.get(dateStr)?.postCount ?? 0) + 1 });
    }
  }

  const calendar = Array.from(calendarMap.entries())
    .map(([date, info]) => ({ date, ...info }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    success: true,
    data: { posts, calendar, totalPosts: posts.length },
  });
}
