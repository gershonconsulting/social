export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/clients/[id]/before-after
 *
 * Returns posting + engagement stats split by the campaign start date —
 * "Before us" (everything posted before campaignStartDate) vs
 * "After us" (everything from campaignStartDate forward). Useful for
 * agency reporting: show clients the lift in volume and engagement that
 * coincided with us managing their campaign.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = await prisma.client.findUnique({
      where: { id },
      select: { id: true, name: true, campaignStartDate: true, timezone: true },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }
    if (!client.campaignStartDate) {
      return NextResponse.json({
        success: true,
        data: {
          campaignStartDate: null,
          before: null,
          after: null,
          message: "No campaign start date set for this client.",
        },
      });
    }

    const startMs = client.campaignStartDate.getTime();
    const startStr = client.campaignStartDate.toISOString().slice(0, 10);

    const posts = await prisma.socialPost.findMany({
      where: { clientId: id },
      // Cap to avoid edge-runtime CPU blowups on clients with thousands of posts.
      take: 1000,
      select: {
        platform: true,
        publishedAtUtc: true,
        publishedDateLocal: true,
        likeCount: true,
        commentCount: true,
        shareCount: true,
      },
    });

    type WindowAgg = {
      posts: number;
      likes: number;
      comments: number;
      shares: number;
      uniqueDays: Set<string>;
      byPlatform: Record<string, { posts: number; likes: number; comments: number; shares: number }>;
      firstPostDate: string | null;
      lastPostDate: string | null;
    };
    const empty = (): WindowAgg => ({
      posts: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      uniqueDays: new Set<string>(),
      byPlatform: {},
      firstPostDate: null,
      lastPostDate: null,
    });
    const before = empty();
    const after = empty();

    for (const p of posts) {
      const t = p.publishedAtUtc.getTime();
      const bucket = t < startMs ? before : after;
      bucket.posts++;
      bucket.likes += p.likeCount || 0;
      bucket.comments += p.commentCount || 0;
      bucket.shares += p.shareCount || 0;
      if (p.publishedDateLocal) bucket.uniqueDays.add(p.publishedDateLocal);
      const pf = bucket.byPlatform[p.platform] || { posts: 0, likes: 0, comments: 0, shares: 0 };
      pf.posts++;
      pf.likes += p.likeCount || 0;
      pf.comments += p.commentCount || 0;
      pf.shares += p.shareCount || 0;
      bucket.byPlatform[p.platform] = pf;
      if (!bucket.firstPostDate || p.publishedDateLocal < bucket.firstPostDate) bucket.firstPostDate = p.publishedDateLocal;
      if (!bucket.lastPostDate || p.publishedDateLocal > bucket.lastPostDate) bucket.lastPostDate = p.publishedDateLocal;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysBefore = before.firstPostDate
      ? Math.max(1, Math.round((startMs - new Date(before.firstPostDate + "T00:00:00Z").getTime()) / (24 * 3600 * 1000)))
      : 0;
    const daysAfter = Math.max(1, Math.round((today.getTime() - startMs) / (24 * 3600 * 1000)));

    const serialize = (b: WindowAgg, daysSpan: number) => ({
      posts: b.posts,
      likes: b.likes,
      comments: b.comments,
      shares: b.shares,
      engagement: b.likes + b.comments + b.shares,
      activeDays: b.uniqueDays.size,
      daysSpan,
      postsPerWeek: daysSpan > 0 ? +(b.posts / (daysSpan / 7)).toFixed(2) : 0,
      avgEngagementPerPost: b.posts > 0 ? +((b.likes + b.comments + b.shares) / b.posts).toFixed(1) : 0,
      firstPostDate: b.firstPostDate,
      lastPostDate: b.lastPostDate,
      byPlatform: b.byPlatform,
    });

    return NextResponse.json({
      success: true,
      data: {
        campaignStartDate: startStr,
        before: serialize(before, daysBefore),
        after: serialize(after, daysAfter),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute before/after";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
