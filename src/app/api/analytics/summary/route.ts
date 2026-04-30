export const runtime = 'edge';
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus } from "@prisma/client";

/**
 * GET /api/analytics/summary?days=30
 *
 * Cross-client aggregation for the Analytics page:
 *   - postsByDay: array of { date, total, byPlatform: {LINKEDIN, TWITTER, ...} }
 *   - byPlatform: totals across the period
 *   - byCategory: company count by clientType
 *   - topPosts: top 10 posts by engagement (likes+comments+shares)
 *   - totals: posts/likes/comments/shares for the period
 *
 * Wraps in try/catch — returns JSON 500 on errors.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const daysRaw = parseInt(url.searchParams.get("days") || "30", 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 30;

    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // Pull all posts in window. Keep select small.
    const posts = await prisma.socialPost.findMany({
      where: { publishedAtUtc: { gte: since } },
      select: {
        id: true,
        clientId: true,
        platform: true,
        postUrl: true,
        postTextSnippet: true,
        publishedDateLocal: true,
        likeCount: true,
        commentCount: true,
        shareCount: true,
        client: { select: { id: true, name: true, clientType: true } },
      },
    });

    // Build day-bucket map
    const dayMap = new Map<string, { date: string; total: number; byPlatform: Record<string, number> }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      dayMap.set(ds, { date: ds, total: 0, byPlatform: {} });
    }

    let totalPosts = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;

    const byPlatform: Record<string, { posts: number; likes: number; comments: number; shares: number }> = {};

    for (const p of posts) {
      totalPosts++;
      totalLikes += p.likeCount || 0;
      totalComments += p.commentCount || 0;
      totalShares += p.shareCount || 0;

      // day bucket
      const ds = p.publishedDateLocal;
      const bucket = dayMap.get(ds);
      if (bucket) {
        bucket.total++;
        bucket.byPlatform[p.platform] = (bucket.byPlatform[p.platform] || 0) + 1;
      }

      // platform totals
      const pf = byPlatform[p.platform] || { posts: 0, likes: 0, comments: 0, shares: 0 };
      pf.posts++;
      pf.likes += p.likeCount || 0;
      pf.comments += p.commentCount || 0;
      pf.shares += p.shareCount || 0;
      byPlatform[p.platform] = pf;
    }

    const postsByDay = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Top 10 posts by engagement
    const topPosts = [...posts]
      .map((p) => ({
        id: p.id,
        platform: p.platform,
        clientName: p.client?.name ?? "?",
        clientId: p.clientId,
        postUrl: p.postUrl,
        textSnippet: p.postTextSnippet,
        publishedDateLocal: p.publishedDateLocal,
        likeCount: p.likeCount || 0,
        commentCount: p.commentCount || 0,
        shareCount: p.shareCount || 0,
        totalEngagement: (p.likeCount || 0) + (p.commentCount || 0) + (p.shareCount || 0),
      }))
      .sort((a, b) => b.totalEngagement - a.totalEngagement)
      .slice(0, 10);

    // Companies by category — pull active clients, count by clientType
    const clients = await prisma.client.findMany({
      where: { status: { not: ClientStatus.ARCHIVED } },
      select: { clientType: true },
    });
    const byCategory: Record<string, number> = {};
    for (const c of clients) {
      const k = c.clientType || "UNKNOWN";
      byCategory[k] = (byCategory[k] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      data: {
        days,
        since: since.toISOString(),
        totals: {
          posts: totalPosts,
          likes: totalLikes,
          comments: totalComments,
          shares: totalShares,
          engagement: totalLikes + totalComments + totalShares,
        },
        postsByDay,
        byPlatform,
        byCategory,
        topPosts,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute analytics";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
