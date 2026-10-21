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
    // v4.59.0 audit: months=0 means "all time" (no lower bound); otherwise 1..12 as before.
    const months = Number.isFinite(monthsRaw) && monthsRaw >= 0 && monthsRaw <= 12 ? monthsRaw : 2;
    const allTime = months === 0;
    const platform = url.searchParams.get("platform") || undefined;
    // Skip calendar generation when the caller only needs the listing.
    // PostsCalendar will request its own. Saves edge CPU.
    const includeCalendar = url.searchParams.get("calendar") !== "0";

    let since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setHours(0, 0, 0, 0);

    const where: Record<string, unknown> = { clientId: id };
    if (!allTime) where.publishedAtUtc = { gte: since };
    if (platform) {
      where.platform = platform;
    }

    // Hard take limit so a client with thousands of posts can't 1102 the worker.
    // v4.59.0 audit: raised 200 -> 1000 and fetch one extra row so we can report
    // `truncated` instead of silently cutting the list.
    const POST_LIMIT = 1000;
    const rows = await prisma.socialPost.findMany({
      where,
      orderBy: { publishedAtUtc: "desc" },
      take: POST_LIMIT + 1,
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

    const truncated = rows.length > POST_LIMIT;
    const posts = truncated ? rows.slice(0, POST_LIMIT) : rows;
    // v4.59.0 audit: all-time calendar starts at the oldest returned post, not the epoch.
    if (allTime) {
      const oldest = posts.length ? new Date(posts[posts.length - 1].publishedAtUtc) : new Date();
      since = new Date(oldest);
      since.setHours(0, 0, 0, 0);
    }

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
      data: { posts, calendar, totalPosts: posts.length, truncated },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error fetching posts";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
