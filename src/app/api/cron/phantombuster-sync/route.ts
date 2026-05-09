export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";
import {
  getPbConfig,
  launchPhantom,
  waitForPhantomFinish,
  downloadCsv,
  parseCsv,
  deletePhantom,
} from "@/lib/phantombuster";

/**
 * GET /api/cron/phantombuster-sync
 *
 * Triggered daily (or manually) to refresh data from Phantombuster.
 * For each platform that has a configured Phantom ID:
 *   1. Launch the phantom (it uses its own pre-saved session cookies + URL list)
 *   2. Poll until it finishes
 *   3. Download the result CSV
 *   4. Parse rows and upsert as SocialPost records on the matching client
 *   5. If deleteAfterRun is enabled, delete the phantom afterwards
 *
 * Optionally protected by CRON_SECRET (Authorization: Bearer ...) so the
 * GitHub Actions workflow can call this without exposing it publicly.
 */
export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get("authorization");
      if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json({
        success: false,
        error: "Phantombuster is not configured. Add the API key in /settings.",
      }, { status: 400 });
    }

    const platforms: Array<{ platform: Platform; phantomId: string | null; csvColumns: { date: string; text: string; link: string; handle: string; likes: string; comments: string; shares: string; profileUrl?: string } }> = [
      {
        platform: Platform.TWITTER,
        phantomId: config.twitterPhantomId,
        csvColumns: {
          date: "tweetDate",
          text: "tweetContent",
          link: "tweetLink",
          handle: "handle",
          likes: "likeCount",
          comments: "commentCount",
          shares: "retweetCount",
          profileUrl: "profileUrl",
        },
      },
      {
        platform: Platform.LINKEDIN,
        phantomId: config.linkedinPhantomId,
        // Verified live from a sample run by Olivier on 2026-05-09:
        // header row is postUrl,imgUrl,type,postContent,likeCount,commentCount,
        //   repostCount,postDate,action,author,authorUrl,profileUrl,timestamp,
        //   viewCount,postTimestamp
        // postDate is relative ("1d") so we use postTimestamp (ISO 8601) instead.
        csvColumns: {
          date: "postTimestamp",
          text: "postContent",
          link: "postUrl",
          handle: "author",
          likes: "likeCount",
          comments: "commentCount",
          shares: "repostCount",
          profileUrl: "authorUrl",
        },
      },
    ];

    const results: Array<{
      platform: string;
      phantomId: string | null;
      launched: boolean;
      finished: string | null;
      rowsParsed: number;
      postsUpserted: number;
      error?: string;
      deleted?: boolean;
    }> = [];

    for (const p of platforms) {
      const r: typeof results[number] = {
        platform: String(p.platform),
        phantomId: p.phantomId,
        launched: false,
        finished: null,
        rowsParsed: 0,
        postsUpserted: 0,
      };
      if (!p.phantomId) {
        r.error = "No Phantom ID configured for this platform.";
        results.push(r);
        continue;
      }

      // 1. Launch
      const launch = await launchPhantom(config.apiKey, p.phantomId);
      if (!launch.containerId) {
        r.error = `Launch failed (HTTP ${launch.rawStatus})${launch.bodyHead ? `: ${launch.bodyHead}` : ""}`;
        results.push(r);
        continue;
      }
      r.launched = true;

      // 2. Wait
      const finish = await waitForPhantomFinish(config.apiKey, p.phantomId, 120_000, 5_000);
      r.finished = finish.lastEndStatus;
      if (finish.lastEndStatus !== "success") {
        r.error = `Phantom run ended with status: ${finish.lastEndStatus}`;
        results.push(r);
        continue;
      }

      // 3. Download CSV
      if (!finish.resultObjectUrl) {
        r.error = "Phantom finished but did not produce a result CSV URL.";
        results.push(r);
        continue;
      }
      const csv = await downloadCsv(finish.resultObjectUrl);
      if (!csv) {
        r.error = "Could not download result CSV.";
        results.push(r);
        continue;
      }

      // 4. Parse + upsert
      const rows = parseCsv(csv);
      r.rowsParsed = Math.max(0, rows.length - 1);
      if (rows.length < 2) {
        results.push(r);
        continue;
      }
      const headers = rows[0].map((h) => h.trim());
      const idx = (name: string) => headers.indexOf(name);

      // Build a map from profileUrl/handle to clientId via existing platformConnections
      const conns = await prisma.platformConnection.findMany({
        where: { platform: p.platform, isEnabled: true },
        select: { id: true, clientId: true, externalAccountUrl: true, externalAccountName: true },
      });
      const findConnection = (handle: string, profileUrl: string | null): { id: string; clientId: string } | null => {
        const norm = (s: string) => s.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\/(?:www\.)?/, "");
        const lhandle = handle.replace(/^@/, "").toLowerCase();
        for (const c of conns) {
          if (c.externalAccountName && c.externalAccountName.replace(/^@/, "").toLowerCase() === lhandle) return c;
          if (profileUrl && c.externalAccountUrl && norm(c.externalAccountUrl) === norm(profileUrl)) return c;
          if (c.externalAccountUrl && c.externalAccountUrl.toLowerCase().includes("/" + lhandle)) return c;
        }
        return null;
      };

      const cDate = idx(p.csvColumns.date);
      const cText = idx(p.csvColumns.text);
      const cLink = idx(p.csvColumns.link);
      const cHandle = idx(p.csvColumns.handle);
      const cLikes = idx(p.csvColumns.likes);
      const cComments = idx(p.csvColumns.comments);
      const cShares = idx(p.csvColumns.shares);
      const cProfile = p.csvColumns.profileUrl ? idx(p.csvColumns.profileUrl) : -1;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length <= cText || cText < 0) continue;
        const text = (row[cText] ?? "").trim();
        const link = (row[cLink] ?? "").trim();
        const handle = (row[cHandle] ?? "").trim();
        const profileUrl = cProfile >= 0 ? (row[cProfile] ?? "").trim() : null;
        if (!text || !link || !handle) continue;

        const conn = findConnection(handle, profileUrl);
        if (!conn) continue;

        // Extract tweet/post id from URL (last digit run is typical)
        const idMatch = link.match(/(\d{8,})/);
        const externalPostId = idMatch ? idMatch[1] : link;

        const dateStr = (row[cDate] ?? "").trim();
        const publishedAtUtc = dateStr ? new Date(dateStr) : new Date();
        if (Number.isNaN(publishedAtUtc.getTime())) continue;
        const publishedDateLocal = publishedAtUtc.toISOString().slice(0, 10);

        await prisma.socialPost.upsert({
          where: {
            clientId_platform_externalPostId: {
              clientId: conn.clientId,
              platform: p.platform,
              externalPostId,
            },
          },
          create: {
            clientId: conn.clientId,
            platformConnectionId: conn.id,
            platform: p.platform,
            externalPostId,
            postUrl: link,
            postTextSnippet: text.slice(0, 280),
            hasMedia: text.includes("https://t.co/") || text.includes("pbs.twimg.com"),
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
        r.postsUpserted++;

        // Mark connection healthy
        try {
          await prisma.platformConnection.update({
            where: { id: conn.id },
            data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
          });
        } catch {}
      }

      // 5. Optional delete
      if (config.deleteAfterRun) {
        r.deleted = await deletePhantom(config.apiKey, p.phantomId);
      }

      results.push(r);
    }

    return NextResponse.json({ success: true, data: { results } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Phantombuster sync failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
