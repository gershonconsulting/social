export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/clients/[id]/posts?months=2&platform=LINKEDIN&calendar=0
 *
 * Returns posts for a client, optionally filtered by platform and date range.
 * Used by the listing view and calendar view.
 *
 * Always wraps work in try/catch so the route returns a JSON 500 (not a
 * Cloudflare HTML error page) — that lets the client distinguish "no posts"
 * from "the API failed", and surface a real error + retry to the user.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = request.nextUrl;
    const monthsRaw = parseInt(url.searchParams.get("months") || "2", 10);
    const months = Number.isFinite(monthsRaw) && monthsRaw > 0 && monthsRaw <= 12 ? monthsRaw : 2;
    const platform = url.searchParams.get("platform") || undefined;
    // Skip calendar generation when the caller only needs the listing.
    // PostsCalendar will request its own. Saves edge CPU.
    const includeCalendar = url.searchParams.get("calendar") !== "0";

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

    // Hard take limit so a client with hundreds of posts can't 1102 the worker.
    // 200 is generous — the UI windows narrow further client-side.
    const posts = await prisma.socialPost.findMany({
      where,
      orderBy: { publishedAtUtc: "desc" },
      take: 200,
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

    let calendar: Array<{ date: string; hasPost: boolean; postCount: number }> = [];
    if (includeCalendar) {
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
          calendarMap.set(dateStr, {
            hasPost: true,
            postCount: (calendarMap.get(dateStr)?.postCount ?? 0) + 1,
          });
        }
      }
      calendar = Array.from(calendarMap.entries())
        .map(([date, info]) => ({ date, ...info }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    return NextResponse.json({
      success: true,
      data: { posts, calendar, totalPosts: posts.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error fetching posts";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
