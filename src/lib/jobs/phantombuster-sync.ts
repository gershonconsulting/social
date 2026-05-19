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

  // Open a SyncJob row so this run shows up in /logs with all the details
  // Olivier needs: which phantom launched, which spreadsheet feeds it, which
  // container ran, CSV URL downloaded, per-account upsert counts, errors.
  const jobStart = new Date();
  type StepLog = {
    step: string;
    at: string;
    detail: Record<string, unknown>;
  };
  const stepLog: StepLog[] = [];
  function logStep(step: string, detail: Record<string, unknown>) {
    stepLog.push({ step, at: new Date().toISOString(), detail });
  }
  logStep("init", {
    apiKey: config.apiKey ? `${config.apiKey.slice(0, 4)}…${config.apiKey.slice(-4)}` : null,
    twitterPhantomId: config.twitterPhantomId,
    linkedinPhantomId: config.linkedinPhantomId,
    deleteAfterRun: config.deleteAfterRun,
  });

  let syncJobId: string | null = null;
  try {
    const row = await prisma.syncJob.create({
      data: {
        jobType: "BACKFILL",
        scopeType: "GLOBAL",
        status: "RUNNING",
        startedAt: jobStart,
        itemsProcessed: 0,
        itemsSucceeded: 0,
        itemsFailed: 0,
        notes: "Phantombuster fallback — runs PB phantoms server-side and upserts CSV results.",
      },
      select: { id: true },
    });
    syncJobId = row.id;
  } catch (e) {
    // Non-fatal — the sync can still run, the user just won't see it in /logs.
    logStep("syncjob-create-failed", { error: e instanceof Error ? e.message : String(e) });
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
      logStep(`${p.platform}: no-phantom-id`, { platform: p.platform });
      results.push(r);
      continue;
    }
    logStep(`${p.platform}: launch-start`, { platform: p.platform, phantomId: p.phantomId });

    const launch = await launchPhantom(config.apiKey, p.phantomId);
    if (!launch.containerId) {
      r.error = `Launch failed (HTTP ${launch.rawStatus})${launch.bodyHead ? `: ${launch.bodyHead}` : ""}`;
      logStep(`${p.platform}: launch-failed`, { platform: p.platform, status: launch.rawStatus, bodyHead: launch.bodyHead });
      results.push(r);
      continue;
    }
    r.launched = true;
    logStep(`${p.platform}: launched`, { platform: p.platform, containerId: launch.containerId });

    const finish = await waitForPhantomFinish(config.apiKey, p.phantomId, 120_000, 5_000);
    r.finished = finish.lastEndStatus;
    logStep(`${p.platform}: finished`, {
      platform: p.platform,
      lastEndStatus: finish.lastEndStatus,
      resultObjectUrl: finish.resultObjectUrl,
    });
    // PB's lastEndType values: "running" | "finished" | "error" | "timeout".
    // "finished" IS the success case — there is no "success" status. We bail
    // only on the truly-bad statuses (and on "running" which means the
    // earlier waitForPhantomFinish hit its deadline).
    const status = finish.lastEndStatus;
    if (status !== "finished") {
      r.error = `Phantom run ended with status: ${status ?? "unknown"}`;
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
      logStep(`${p.platform}: csv-download-failed`, { url: finish.resultObjectUrl });
      results.push(r);
      continue;
    }
    logStep(`${p.platform}: csv-downloaded`, {
      platform: p.platform,
      url: finish.resultObjectUrl,
      bytes: csv.length,
    });

    const rows = parseCsv(csv);
    r.rowsParsed = Math.max(0, rows.length - 1);
    logStep(`${p.platform}: csv-parsed`, { platform: p.platform, totalRows: r.rowsParsed });
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

    logStep(`${p.platform}: done`, {
      platform: p.platform,
      rowsParsed: r.rowsParsed,
      postsUpserted: r.postsUpserted,
      deleted: r.deleted ?? false,
      error: r.error ?? null,
    });
    results.push(r);
  }

  // Close the SyncJob row with the full breakdown.
  if (syncJobId) {
    const totalUpserted = results.reduce((s, x) => s + (x.postsUpserted ?? 0), 0);
    const totalRows = results.reduce((s, x) => s + (x.rowsParsed ?? 0), 0);
    const anyErrors = results.some((x) => !!x.error);
    const status = anyErrors && totalUpserted === 0 ? "FAILED"
      : anyErrors ? "PARTIAL"
      : "COMPLETED";
    try {
      await prisma.syncJob.update({
        where: { id: syncJobId },
        data: {
          status,
          finishedAt: new Date(),
          itemsProcessed: results.length,
          itemsSucceeded: results.filter((x) => !x.error).length,
          itemsFailed: results.filter((x) => !!x.error).length,
          errorLogJson: anyErrors
            ? JSON.stringify(results.filter((x) => x.error).map((x) => `${x.platform}: ${x.error}`))
            : null,
          resultsJson: JSON.stringify({
            phantoms: results,
            steps: stepLog,
            totalRowsParsed: totalRows,
            totalPostsUpserted: totalUpserted,
            spreadsheets: {
              twitter: "https://docs.google.com/spreadsheets/d/1YpDcoQHF-g-TakXG8EHdMymXfVBvXRP1gLF1FqX-V9c/edit?gid=2068816684",
              linkedin: "https://docs.google.com/spreadsheets/d/1YpDcoQHF-g-TakXG8EHdMymXfVBvXRP1gLF1FqX-V9c/edit",
            },
          }),
        },
      });
    } catch { /* non-fatal */ }
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
