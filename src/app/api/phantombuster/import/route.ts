export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";
import { getPbConfig, fetchContainerResultObject } from "@/lib/phantombuster";

/**
 * POST /api/phantombuster/import
 * Body: { platform: 'TWITTER' | 'LINKEDIN', containerId: string, clientId?: string }
 *
 * Fetches the per-container resultObject (fresh JSON array of scraped
 * records for THIS run) and upserts each record into SocialPost.
 *
 * If clientId is supplied, posts are mapped directly to that client's
 * platform connection. Otherwise we fall back to fuzzy handle matching
 * against PlatformConnection rows (used by the daily cron path).
 */
type TwitterRec = {
  tweetDate?: string; tweetContent?: string; tweetLink?: string; handle?: string;
  likeCount?: number | string; commentCount?: number | string; retweetCount?: number | string;
  profileUrl?: string;
};
type LinkedInRec = {
  postTimestamp?: string; postDate?: string; postContent?: string; postUrl?: string;
  author?: string; authorUrl?: string; profileUrl?: string;
  likeCount?: number | string; commentCount?: number | string; repostCount?: number | string;
};

function asInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseInt(v, 10) || 0;
  return 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { platform?: string; containerId?: string; clientId?: string | null }
      | null;
    if (!body || !body.platform || !body.containerId) {
      return NextResponse.json({ success: false, error: "platform + containerId required" }, { status: 400 });
    }
    const platform = body.platform as Platform;
    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: "Phantombuster is not configured." }, { status: 400 });
    }

    // Fetch the per-container result (fresh data from the launch we just did)
    const records = await fetchContainerResultObject(config.apiKey, body.containerId);
    if (!records) {
      return NextResponse.json({
        success: false,
        error: "Phantom returned no result (often: expired session cookie or zero matches).",
      }, { status: 502 });
    }
    if (records.length === 0) {
      return NextResponse.json({ success: true, data: { recordsParsed: 0, postsUpserted: 0 } });
    }

    // Resolve which connection (and therefore which client) to attach posts to
    type Conn = { id: string; clientId: string; externalAccountUrl: string | null; externalAccountName: string | null };
    let conns: Conn[] = [];
    if (body.clientId) {
      conns = await prisma.platformConnection.findMany({
        where: { clientId: body.clientId, platform, isEnabled: true },
        select: { id: true, clientId: true, externalAccountUrl: true, externalAccountName: true },
      });
    } else {
      conns = await prisma.platformConnection.findMany({
        where: { platform, isEnabled: true },
        select: { id: true, clientId: true, externalAccountUrl: true, externalAccountName: true },
      });
    }

    const norm = (s: string) => s.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\/(?:www\.)?/, "");
    const findConn = (handle: string, profileUrl: string | null): Conn | null => {
      // When clientId is provided, just return the only matching conn for this platform.
      if (body.clientId && conns.length > 0) return conns[0];
      const lhandle = handle.replace(/^@/, "").toLowerCase();
      for (const c of conns) {
        if (c.externalAccountName && c.externalAccountName.replace(/^@/, "").toLowerCase() === lhandle) return c;
        if (profileUrl && c.externalAccountUrl && norm(c.externalAccountUrl) === norm(profileUrl)) return c;
        if (c.externalAccountUrl && c.externalAccountUrl.toLowerCase().includes("/" + lhandle)) return c;
      }
      return null;
    };

    type UpsertArg = Parameters<typeof prisma.socialPost.upsert>[0];
    const ops: UpsertArg[] = [];
    const touchedConnIds = new Set<string>();

    for (const raw of records) {
      const rec = raw as TwitterRec & LinkedInRec;
      const isTwitter = platform === Platform.TWITTER;
      const text = (isTwitter ? rec.tweetContent : rec.postContent) ?? "";
      const link = (isTwitter ? rec.tweetLink : rec.postUrl) ?? "";
      const handle = (isTwitter ? rec.handle : rec.author) ?? "";
      const profileUrl = (isTwitter ? rec.profileUrl : rec.authorUrl) ?? null;
      if (!text || !link) continue;
      const conn = findConn(handle, profileUrl);
      if (!conn) continue;
      const idMatch = link.match(/(\d{8,})/);
      const externalPostId = idMatch ? idMatch[1] : link;
      const dateStr = (isTwitter ? rec.tweetDate : (rec.postTimestamp ?? rec.postDate)) ?? "";
      const publishedAtUtc = dateStr ? new Date(dateStr) : new Date();
      if (Number.isNaN(publishedAtUtc.getTime())) continue;
      const publishedDateLocal = publishedAtUtc.toISOString().slice(0, 10);
      const likeCount = asInt(rec.likeCount);
      const commentCount = asInt(rec.commentCount);
      const shareCount = asInt(isTwitter ? rec.retweetCount : rec.repostCount);
      ops.push({
        where: {
          clientId_platform_externalPostId: { clientId: conn.clientId, platform, externalPostId },
        },
        create: {
          clientId: conn.clientId,
          platformConnectionId: conn.id,
          platform,
          externalPostId,
          postUrl: link,
          postTextSnippet: text.slice(0, 280),
          hasMedia: false,
          publishedAtUtc,
          publishedAtLocal: publishedAtUtc,
          publishedDateLocal,
          likeCount,
          commentCount,
          shareCount,
          rawPayloadJson: JSON.stringify(rec),
        },
        update: {
          postUrl: link,
          postTextSnippet: text.slice(0, 280),
          likeCount,
          commentCount,
          shareCount,
        },
      });
      touchedConnIds.add(conn.id);
    }

    let postsUpserted = 0;
    if (ops.length > 0) {
      await prisma.$transaction(ops.map((o) => prisma.socialPost.upsert(o)));
      postsUpserted = ops.length;
    }
    if (touchedConnIds.size > 0) {
      try {
        await prisma.platformConnection.updateMany({
          where: { id: { in: Array.from(touchedConnIds) } },
          data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
        });
      } catch {}
    }

    return NextResponse.json({
      success: true,
      data: { recordsParsed: records.length, postsUpserted },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
