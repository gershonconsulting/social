export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

/**
 * POST /api/scrape/import
 *
 * Receives pre-parsed posts scraped by an EXTERNAL agent (the local
 * Playwright "social-watchman" tool, or the connected-Chrome scraping
 * path). No Phantombuster involved — the caller has already extracted
 * post text + URL + timestamp from the platform's DOM.
 *
 * Body:
 * {
 *   clientId: string,
 *   platform: 'LINKEDIN' | 'TWITTER' | 'GOOGLE_BUSINESS',
 *   posts: [{
 *     externalPostId: string,
 *     postUrl: string,
 *     text: string,
 *     publishedAtUtc: string,       // ISO 8601
 *     likeCount?: number,
 *     commentCount?: number,
 *     shareCount?: number,
 *     hasMedia?: boolean,
 *   }]
 * }
 *
 * Upserts SocialPost rows on (clientId, platform, externalPostId) and
 * updates the matching PlatformConnection's lastSyncAt/lastSyncError/status.
 */
type IncomingPost = {
  externalPostId?: string;
  postUrl?: string;
  text?: string;
  publishedAtUtc?: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  hasMedia?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { clientId?: string; platform?: string; posts?: IncomingPost[] }
      | null;
    if (!body?.clientId || !body?.platform || !Array.isArray(body.posts)) {
      return NextResponse.json(
        { success: false, error: "clientId, platform, posts[] required" },
        { status: 400 },
      );
    }
    const platform = body.platform as Platform;
    const conn = await prisma.platformConnection.findFirst({
      where: { clientId: body.clientId, platform, isEnabled: true },
      select: { id: true, clientId: true },
    });
    if (!conn) {
      return NextResponse.json(
        { success: false, error: `No enabled ${body.platform} connection for client ${body.clientId}` },
        { status: 404 },
      );
    }

    type UpsertArg = Parameters<typeof prisma.socialPost.upsert>[0];
    const ops: UpsertArg[] = [];
    for (const p of body.posts) {
      if (!p.externalPostId || !p.postUrl || !p.text || !p.publishedAtUtc) continue;
      const publishedAtUtc = new Date(p.publishedAtUtc);
      if (Number.isNaN(publishedAtUtc.getTime())) continue;
      const publishedDateLocal = publishedAtUtc.toISOString().slice(0, 10);
      const likeCount = Number(p.likeCount || 0);
      const commentCount = Number(p.commentCount || 0);
      const shareCount = Number(p.shareCount || 0);
      ops.push({
        where: {
          clientId_platform_externalPostId: {
            clientId: conn.clientId,
            platform,
            externalPostId: p.externalPostId,
          },
        },
        create: {
          clientId: conn.clientId,
          platformConnectionId: conn.id,
          platform,
          externalPostId: p.externalPostId,
          postUrl: p.postUrl,
          postTextSnippet: (p.text || "").slice(0, 280),
          hasMedia: !!p.hasMedia,
          publishedAtUtc,
          publishedAtLocal: publishedAtUtc,
          publishedDateLocal,
          likeCount,
          commentCount,
          shareCount,
          rawPayloadJson: JSON.stringify({ scraped: p }),
        },
        update: {
          postUrl: p.postUrl,
          postTextSnippet: (p.text || "").slice(0, 280),
          publishedAtUtc,
          publishedAtLocal: publishedAtUtc,
          publishedDateLocal,
          hasMedia: !!p.hasMedia,
          likeCount,
          commentCount,
          shareCount,
        },
      });
    }

    let postsUpserted = 0;
    if (ops.length > 0) {
      await prisma.$transaction(ops.map((o) => prisma.socialPost.upsert(o)));
      postsUpserted = ops.length;
    }
    try {
      await prisma.platformConnection.update({
        where: { id: conn.id },
        data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      data: { received: body.posts.length, postsUpserted },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
