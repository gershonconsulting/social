/**
 * Phantombuster sync job — extracted from /api/cron/phantombuster-sync so
 * the daily-sync orchestrator can call it as a fallback when the Chrome
 * extension hasn't refreshed a connection in >24h.
 *
 * Architecture:
 *   1. Extension v0.10.0 runs daily inside the user's browser (primary).
 *      On success it stamps PlatformConnection.lastSyncAt.
 *   2. Server cron at 06:00 UTC checks for stale lastSyncAt. If any are
 *      stale (or null), it calls runPhantombusterSync() to backfill.
 *
 * Why a fallback at all: the extension only runs when Chrome is open.
 * Phantombuster runs real browsers on residential proxies from PB's
 * infrastructure, so it doesn't depend on Olivier's machine state.
 */

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

export interface PhantombusterSyncResult {
  platform: string;
  phantomId: string | null;
  launched: boolean;
  finished: string | null;
  rowsParsed: number;
  postsUpserted: number;
  error?: string;
  deleted?: boolean;
}

/**
 * Run the Phantombuster sync for all configured platforms (LinkedIn + X).
 * Returns one result row per platform — never throws (errors are folded
 * into the result objects so callers can surface them in the cron report).
 */
export async function runPhantombusterSync(): Promise<{
  ok: boolean;
  results: PhantombusterSyncResult[];
  error?: string;
}> {
  const config = await getPbConfig();
  if (!config) {
    return {
      ok: false,
      results: [],
      error: "Phantombuster is not configured. Add the API key in /settings.",
    };
  }

  const platforms: Array<{
    platform: Platform;
    phantomId: string | null;
    csvColumns: {
      date: string;
      text: string;
      link: string;
      handle: string;
      likes: string;
      comments: string;
      shares: string;
      profileUrl?: string;
    };
  }> = [
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

  const results: PhantombusterSyncResult[] = [];

  for (const p of platforms) {
    const r: PhantombusterSyncResult = {
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

    const launch = await launchPhantom(config.apiKey, p.phantomId);
    if (!launch.containerId) {
      r.error = `Launch failed (HTTP ${launch.rawStatus})${launch.bodyHead ? `: ${launch.bodyHead}` : ""}`;
      results.push(r);
      continue;
    }
    r.launched = true;

    const finish = await waitForPhantomFinish(config.apiKey, p.phantomId, 120_000, 5_000);
    r.finished = finish.lastEndStatus;
    if (finish.lastEndStatus !== "success") {
      r.error = `Phantom run ended with status: ${finish.lastEndStatus}`;
      results.push(r);
      continue;
    }

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

    const rows = parseCsv(csv);
    r.rowsParsed = Math.max(0, rows.length - 1);
    if (rows.length < 2) {
      results.push(r);
      continue;
    }
    const headers = rows[0].map((h) => h.trim());
    const idx = (name: string) => headers.indexOf(name);

    const conns = await prisma.platformConnection.findMany({
      where: { platform: p.platform, isEnabled: true },
      select: { id: true, clientId: true, externalAccountUrl: true, externalAccountName: true },
    });
    const findConnection = (
      handle: string,
      profileUrl: string | null
    ): { id: string; clientId: string } | null => {
      const norm = (s: string) =>
        s.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\/(?:www\.)?/, "");
      const lhandle = handle.replace(/^@/, "").toLowerCase();
      for (const c of conns) {
        if (
          c.externalAccountName &&
          c.externalAccountName.replace(/^@/, "").toLowerCase() === lhandle
        )
          return c;
        if (
          profileUrl &&
          c.externalAccountUrl &&
          norm(c.externalAccountUrl) === norm(profileUrl)
        )
          return c;
        if (
          c.externalAccountUrl &&
          c.externalAccountUrl.toLowerCase().includes("/" + lhandle)
        )
          return c;
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
          rawPayloadJson: JSON.stringify({ csvRow: row, source: "phantombuster-fallback" }),
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

      try {
        await prisma.platformConnection.update({
          where: { id: conn.id },
          data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
        });
      } catch {}
    }

    if (config.deleteAfterRun) {
      r.deleted = await deletePhantom(config.apiKey, p.phantomId);
    }

    results.push(r);
  }

  return { ok: true, results };
}

/**
 * Returns the list of PlatformConnections whose lastSyncAt is null or older
 * than `maxAgeMs`. Used by the daily orchestrator to decide whether the
 * Phantombuster fallback needs to run.
 *
 * Defaults to 22h (slightly less than 24h so a once-a-day cron always sees
 * yesterday's run as stale).
 */
export async function findStaleConnections(
  maxAgeMs: number = 22 * 60 * 60 * 1000
): Promise<Array<{ id: string; clientId: string; platform: Platform; lastSyncAt: Date | null }>> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await prisma.platformConnection.findMany({
    where: {
      isEnabled: true,
      isMandatory: true,
      platform: { in: [Platform.LINKEDIN, Platform.TWITTER] },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: cutoff } }],
    },
    select: { id: true, clientId: true, platform: true, lastSyncAt: true },
  });
  return rows;
}
