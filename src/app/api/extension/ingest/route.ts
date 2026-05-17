export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

/**
 * POST /api/extension/ingest
 *
 * Receives a batch of posts scraped by the GershonAI Chrome extension from
 * inside the user's logged-in linkedin.com / x.com tabs. Each result is
 * upserted into SocialPost keyed on (clientId, platform, externalPostId).
 *
 * Body:
 *   {
 *     results: [
 *       {
 *         clientId: string,
 *         connectionId: string,
 *         platform: "LINKEDIN" | "TWITTER",
 *         posts: [
 *           {
 *             externalPostId: string,
 *             postUrl?: string,
 *             postTextSnippet?: string,
 *             hasMedia?: boolean,
 *             publishedAtUtc?: string (ISO),
 *             likeCount?: number,
 *             commentCount?: number,
 *             shareCount?: number,
 *             viewCount?: number,
 *             rawPayload?: any
 *           }
 *         ],
 *         error?: string
 *       }
 *     ]
 *   }
 *
 * Response:
 *   { success: true, data: { totalUpserted, totalAttempts, failed, perClient: [...] } }
 */

interface IncomingPost {
  externalPostId?: string;
  postUrl?: string;
  postTextSnippet?: string;
  hasMedia?: boolean;
  publishedAtUtc?: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  viewCount?: number;
  rawPayload?: unknown;
}
interface IncomingResult {
  clientId?: string;
  connectionId?: string;
  platform?: string;
  posts?: IncomingPost[];
  error?: string;
}
interface IncomingBody { results?: IncomingResult[]; }

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as IncomingBody | null;
    if (!body?.results || !Array.isArray(body.results)) {
      return NextResponse.json({ success: false, error: "results[] required" }, { status: 400 });
    }

    const perClient: Array<{
      clientId: string;
      platform: string;
      attempted: number;
      upserted: number;
      error?: string;
    }> = [];

    let totalUpserted = 0;
    let totalAttempts = 0;
    let failed = 0;

    for (const r of body.results) {
      const platStr = (r.platform || "").toUpperCase();
      if (
        !r.clientId ||
        !r.connectionId ||
        (platStr !== "LINKEDIN" && platStr !== "TWITTER")
      ) {
        failed++;
        perClient.push({
          clientId: r.clientId ?? "?",
          platform: r.platform ?? "?",
          attempted: 0,
          upserted: 0,
          error: "missing clientId / connectionId / platform",
        });
        continue;
      }
      const platform = platStr === "LINKEDIN" ? Platform.LINKEDIN : Platform.TWITTER;

      if (r.error) {
        failed++;
        perClient.push({
          clientId: r.clientId,
          platform: platStr,
          attempted: 0,
          upserted: 0,
          error: r.error,
        });
        try {
          await prisma.platformConnection.update({
            where: { id: r.connectionId },
            data: { lastSyncError: r.error.slice(0, 500), lastSyncAt: new Date() },
          });
        } catch {}
        continue;
      }

      const posts = Array.isArray(r.posts) ? r.posts : [];
      totalAttempts += posts.length;
      let upserted = 0;
      const ops = [];
      for (const p of posts) {
        if (!p.externalPostId) continue;
        const publishedAt = p.publishedAtUtc ? new Date(p.publishedAtUtc) : new Date();
        if (isNaN(publishedAt.getTime())) continue;
        const dateLocal = publishedAt.toISOString().slice(0, 10);
        ops.push({
          where: {
            clientId_platform_externalPostId: {
              clientId: r.clientId,
              platform,
              externalPostId: p.externalPostId,
            },
          },
          create: {
            clientId: r.clientId,
            platformConnectionId: r.connectionId,
            platform,
            externalPostId: p.externalPostId,
            postUrl: p.postUrl ?? null,
            postTextSnippet: (p.postTextSnippet ?? "").slice(0, 280),
            hasMedia: !!p.hasMedia,
            publishedAtUtc: publishedAt,
            publishedAtLocal: publishedAt,
            publishedDateLocal: dateLocal,
            likeCount: Number(p.likeCount ?? 0),
            commentCount: Number(p.commentCount ?? 0),
            shareCount: Number(p.shareCount ?? 0),
            viewCount: Number(p.viewCount ?? 0),
            rawPayloadJson: JSON.stringify({
              source: "extension-v0.9",
              raw: p.rawPayload ?? null,
            }),
          },
          update: {
            postUrl: p.postUrl ?? undefined,
            postTextSnippet: (p.postTextSnippet ?? "").slice(0, 280),
            publishedAtUtc: publishedAt,
            publishedAtLocal: publishedAt,
            publishedDateLocal: dateLocal,
            likeCount: Number(p.likeCount ?? 0),
            commentCount: Number(p.commentCount ?? 0),
            shareCount: Number(p.shareCount ?? 0),
            viewCount: Number(p.viewCount ?? 0),
          },
        });
      }

      if (ops.length > 0) {
        try {
          await prisma.$transaction(ops.map((o) => prisma.socialPost.upsert(o)));
          upserted = ops.length;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          perClient.push({
            clientId: r.clientId,
            platform: platStr,
            attempted: posts.length,
            upserted: 0,
            error: "db: " + msg.slice(0, 200),
          });
          failed++;
          continue;
        }
      }

      try {
        await prisma.platformConnection.update({
          where: { id: r.connectionId },
          data: {
            connectionStatus: "CONNECTED",
            lastSyncError: null,
            lastSyncAt: new Date(),
          },
        });
      } catch {}

      totalUpserted += upserted;
      perClient.push({
        clientId: r.clientId,
        platform: platStr,
        attempted: posts.length,
        upserted,
      });
    }

    return NextResponse.json({
      success: true,
      data: { totalUpserted, totalAttempts, failed, perClient },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
