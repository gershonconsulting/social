export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";
import { getPbConfig, downloadCsv, parseCsv, deletePhantom } from "@/lib/phantombuster";

/**
 * POST /api/phantombuster/import
 * Body: { platform: 'TWITTER' | 'LINKEDIN', phantomId: string, resultUrl: string }
 *
 * Downloads the result CSV from S3, parses it, and upserts each row into
 * SocialPost (matching the right client by handle/profileUrl). Single-shot
 * fast call — fits well within Cloudflare's worker time budget. Returns the
 * count of rows parsed and posts upserted.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { platform?: string; phantomId?: string; resultUrl?: string }
      | null;
    if (!body || !body.platform || !body.phantomId || !body.resultUrl) {
      return NextResponse.json({ success: false, error: "platform, phantomId, resultUrl required" }, { status: 400 });
    }
    const platform = body.platform as Platform;
    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: "Phantombuster is not configured." }, { status: 400 });
    }

    const csv = await downloadCsv(body.resultUrl);
    if (!csv) {
      return NextResponse.json({ success: false, error: "Could not download result CSV." }, { status: 502 });
    }
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      return NextResponse.json({ success: true, data: { rowsParsed: 0, postsUpserted: 0 } });
    }
    const headers = rows[0].map((h) => h.trim());
    const idx = (n: string) => headers.indexOf(n);

    const cols =
      platform === Platform.TWITTER
        ? { date: "tweetDate", text: "tweetContent", link: "tweetLink", handle: "handle", likes: "likeCount", comments: "commentCount", shares: "retweetCount", profileUrl: "profileUrl" }
        : { date: "postTimestamp", text: "postContent", link: "postUrl", handle: "author", likes: "likeCount", comments: "commentCount", shares: "repostCount", profileUrl: "authorUrl" };

    const cDate = idx(cols.date);
    const cText = idx(cols.text);
    const cLink = idx(cols.link);
    const cHandle = idx(cols.handle);
    const cLikes = idx(cols.likes);
    const cComments = idx(cols.comments);
    const cShares = idx(cols.shares);
    const cProfile = idx(cols.profileUrl);

    const conns = await prisma.platformConnection.findMany({
      where: { platform, isEnabled: true },
      select: { id: true, clientId: true, externalAccountUrl: true, externalAccountName: true },
    });
    const norm = (s: string) => s.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\/(?:www\.)?/, "");
    const findConn = (handle: string, profileUrl: string | null) => {
      const lhandle = handle.replace(/^@/, "").toLowerCase();
      for (const c of conns) {
        if (c.externalAccountName && c.externalAccountName.replace(/^@/, "").toLowerCase() === lhandle) return c;
        if (profileUrl && c.externalAccountUrl && norm(c.externalAccountUrl) === norm(profileUrl)) return c;
        if (c.externalAccountUrl && c.externalAccountUrl.toLowerCase().includes("/" + lhandle)) return c;
      }
      return null;
    };

    // Build the list of upsert ops first, then run them in a single $transaction.
    // De-dupe per-connection updates so we hit each connection at most once
    // (saves DB round-trips — important for Cloudflare Workers' time budget).
    type Upsert = Parameters<typeof prisma.socialPost.upsert>[0];
    const ops: Upsert[] = [];
    const touchedConnIds = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (cText < 0 || row.length <= cText) continue;
      const text = (row[cText] ?? "").trim();
      const link = (row[cLink] ?? "").trim();
      const handle = (row[cHandle] ?? "").trim();
      const profileUrl = cProfile >= 0 ? (row[cProfile] ?? "").trim() : null;
      if (!text || !link || !handle) continue;
      const conn = findConn(handle, profileUrl);
      if (!conn) continue;
      const idMatch = link.match(/(\d{8,})/);
      const externalPostId = idMatch ? idMatch[1] : link;
      const dateStr = (row[cDate] ?? "").trim();
      const publishedAtUtc = dateStr ? new Date(dateStr) : new Date();
      if (Number.isNaN(publishedAtUtc.getTime())) continue;
      const publishedDateLocal = publishedAtUtc.toISOString().slice(0, 10);
      ops.push({
        where: {
          clientId_platform_externalPostId: {
            clientId: conn.clientId,
            platform,
            externalPostId,
          },
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
          likeCount: parseInt(row[cLikes] || "0", 10) || 0,
          commentCount: parseInt(row[cComments] || "0", 10) || 0,
          shareCount: parseInt(row[cShares] || "0", 10) || 0,
          rawPayloadJson: JSON.stringify({ csvRow: row }),
        },
        update: {
          postUrl: link,
          postTextSnippet: text.slice(0, 280),
          likeCount: parseInt(row[cLikes] || "0", 10) || 0,
          commentCount: parseInt(row[cComments] || "0", 10) || 0,
          shareCount: parseInt(row[cShares] || "0", 10) || 0,
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

    let deleted = false;
    if (config.deleteAfterRun && body.phantomId) {
      deleted = await deletePhantom(config.apiKey, body.phantomId);
    }

    return NextResponse.json({
      success: true,
      data: { rowsParsed: rows.length - 1, postsUpserted, deleted },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
