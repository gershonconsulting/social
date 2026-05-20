export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";
import { getPbConfig } from "@/lib/phantombuster";

/**
 * GET /api/cron/pb-import-latest
 *
 * Imports the latest CSVs sitting in PB S3 — does NOT launch a fresh PB
 * run. Designed to fit inside the Cloudflare worker time budget so it
 * runs reliably from the daily cron.
 *
 * Why this exists (vs the older /api/cron/phantombuster-sync that launched
 * a run + waited): the launch+wait flow takes 30-60s per platform and
 * blew past the worker time budget. PB runs on its own internal schedule
 * already (the spreadsheet-driven phantoms accumulate data in S3 every
 * run), so we only need to pull the latest CSV each day.
 *
 * Strategy per platform:
 *   1. Fetch the agent metadata to get the s3Folder + saved csvName.
 *   2. Build the canonical CSV URL: phantombuster.s3/<orgFolder>/<s3Folder>/<csvName>.csv
 *   3. Download.
 *   4. Parse + match handle → clientId via PlatformConnection lookup.
 *   5. Upsert SocialPost rows in capped batches (max 25/client) to stay
 *      inside the worker budget.
 *
 * Auth: Bearer CRON_SECRET (when set).
 * Response: { success, data: { perPlatform: [{ platform, rowsParsed,
 *           clientsMatched, postsUpserted, csvUrl, error? }] } }
 */

interface PlatformReport {
  platform: string;
  csvUrl: string | null;
  rowsParsed: number;
  rowsMatched: number;
  clientsMatched: number;
  postsUpserted: number;
  perClient: Array<{ name: string; vanity: string; count: number }>;
  error?: string;
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
      else if (ch === "\r") { /* skip */ }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  return out;
}

async function fetchAgentMeta(apiKey: string, id: string): Promise<{ s3Folder?: string; orgS3Folder?: string; argument?: string } | null> {
  try {
    const r = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch?id=${id}`, {
      headers: { "x-phantombuster-key": apiKey },
    });
    if (!r.ok) return null;
    return await r.json() as { s3Folder?: string; orgS3Folder?: string; argument?: string };
  } catch { return null; }
}

function csvNameFromAgent(agent: { argument?: string } | null): string {
  if (!agent?.argument) return "result";
  try {
    const a = JSON.parse(agent.argument) as { csvName?: string };
    return a.csvName?.trim() || "result";
  } catch { return "result"; }
}

async function importTwitter(apiKey: string, phantomId: string): Promise<PlatformReport> {
  const r: PlatformReport = { platform: "TWITTER", csvUrl: null, rowsParsed: 0, rowsMatched: 0, clientsMatched: 0, postsUpserted: 0, perClient: [] };
  const meta = await fetchAgentMeta(apiKey, phantomId);
  if (!meta?.s3Folder || !meta?.orgS3Folder) {
    r.error = "Could not fetch agent metadata from Phantombuster.";
    return r;
  }
  const csvName = csvNameFromAgent(meta);
  const csvUrl = `https://phantombuster.s3.amazonaws.com/${meta.orgS3Folder}/${meta.s3Folder}/${encodeURIComponent(csvName)}.csv`;
  r.csvUrl = csvUrl;
  const cr = await fetch(csvUrl);
  if (!cr.ok) {
    r.error = `CSV fetch failed: HTTP ${cr.status}`;
    return r;
  }
  const text = await cr.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return r;
  r.rowsParsed = rows.length - 1;
  const headers = rows[0].map((h) => h.trim());
  const idx = (n: string) => headers.indexOf(n);
  const iLink = idx("tweetLink");
  const iText = idx("tweetContent");
  const iDate = idx("tweetDate");
  const iLikes = idx("likeCount");
  const iComments = idx("commentCount");
  const iRetweets = idx("retweetCount");
  const iMedia = idx("mediaUrl1");
  if (iLink < 0 || iText < 0) {
    r.error = "Twitter CSV missing tweetLink/tweetContent columns.";
    return r;
  }

  const conns = await prisma.platformConnection.findMany({
    where: { platform: Platform.TWITTER, isEnabled: true },
    select: { id: true, clientId: true, externalAccountUrl: true, externalAccountName: true, client: { select: { name: true } } },
  });
  const handleMap = new Map<string, { connId: string; clientId: string; name: string }>();
  for (const c of conns) {
    const url = (c.externalAccountUrl || "").toLowerCase();
    const m = url.match(/(?:twitter|x)\.com\/([a-z0-9_]+)/i);
    if (m) handleMap.set(m[1].toLowerCase(), { connId: c.id, clientId: c.clientId, name: c.client.name });
  }

  const byClient = new Map<string, { conn: { connId: string; clientId: string; name: string }; vanity: string; rows: typeof rows }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const link = (row[iLink] ?? "").trim();
    const text = (row[iText] ?? "").trim();
    if (!link || !text) continue;
    const hm = link.match(/(?:twitter|x)\.com\/([a-z0-9_]+)/i);
    if (!hm) continue;
    const handle = hm[1].toLowerCase();
    const conn = handleMap.get(handle);
    if (!conn) continue;
    r.rowsMatched++;
    let slot = byClient.get(handle);
    if (!slot) { slot = { conn, vanity: handle, rows: [] }; byClient.set(handle, slot); }
    slot.rows.push(row);
  }
  r.clientsMatched = byClient.size;

  for (const [handle, slot] of byClient) {
    // Cap at 25 most-recent per client to stay in budget
    const trimmed = slot.rows
      .map((row) => {
        const link = (row[iLink] ?? "").trim();
        const text = (row[iText] ?? "").trim();
        const date = (row[iDate] ?? "").trim();
        const tidM = link.match(/\/status\/(\d+)/);
        let pubAt: Date | null = null;
        if (date) {
          const d = new Date(date);
          if (!isNaN(d.getTime())) pubAt = d;
        }
        return {
          externalPostId: tidM ? tidM[1] : link,
          postUrl: link,
          postTextSnippet: text.slice(0, 280),
          hasMedia: !!(iMedia >= 0 && (row[iMedia] ?? "").trim()),
          publishedAtUtc: pubAt ?? new Date(),
          likeCount: parseInt(row[iLikes] || "0", 10) || 0,
          commentCount: parseInt(row[iComments] || "0", 10) || 0,
          shareCount: parseInt(row[iRetweets] || "0", 10) || 0,
        };
      })
      .filter((p) => !!p.externalPostId)
      .sort((a, b) => b.publishedAtUtc.getTime() - a.publishedAtUtc.getTime())
      .slice(0, 25);
    let upserted = 0;
    for (const p of trimmed) {
      try {
        const dateLocal = p.publishedAtUtc.toISOString().slice(0, 10);
        await prisma.socialPost.upsert({
          where: {
            clientId_platform_externalPostId: {
              clientId: slot.conn.clientId,
              platform: Platform.TWITTER,
              externalPostId: p.externalPostId,
            },
          },
          create: {
            clientId: slot.conn.clientId,
            platformConnectionId: slot.conn.connId,
            platform: Platform.TWITTER,
            externalPostId: p.externalPostId,
            postUrl: p.postUrl,
            postTextSnippet: p.postTextSnippet,
            hasMedia: p.hasMedia,
            publishedAtUtc: p.publishedAtUtc,
            publishedAtLocal: p.publishedAtUtc,
            publishedDateLocal: dateLocal,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            shareCount: p.shareCount,
            rawPayloadJson: JSON.stringify({ source: "pb-import-latest" }),
          },
          update: {
            postTextSnippet: p.postTextSnippet,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            shareCount: p.shareCount,
          },
        });
        upserted++;
      } catch { /* per-row failures don't abort the batch */ }
    }
    r.postsUpserted += upserted;
    r.perClient.push({ name: slot.conn.name, vanity: handle, count: upserted });
    try {
      await prisma.platformConnection.update({
        where: { id: slot.conn.connId },
        data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
      });
    } catch {}
  }

  return r;
}

async function importLinkedIn(apiKey: string, phantomId: string): Promise<PlatformReport> {
  const r: PlatformReport = { platform: "LINKEDIN", csvUrl: null, rowsParsed: 0, rowsMatched: 0, clientsMatched: 0, postsUpserted: 0, perClient: [] };
  const meta = await fetchAgentMeta(apiKey, phantomId);
  if (!meta?.s3Folder || !meta?.orgS3Folder) {
    r.error = "Could not fetch agent metadata from Phantombuster.";
    return r;
  }
  const csvName = csvNameFromAgent(meta);
  const csvUrl = `https://phantombuster.s3.amazonaws.com/${meta.orgS3Folder}/${meta.s3Folder}/${encodeURIComponent(csvName)}.csv`;
  r.csvUrl = csvUrl;
  const cr = await fetch(csvUrl);
  if (!cr.ok) {
    r.error = `CSV fetch failed: HTTP ${cr.status}`;
    return r;
  }
  const text = await cr.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return r;
  r.rowsParsed = rows.length - 1;
  const headers = rows[0].map((h) => h.trim());
  const idx = (n: string) => headers.indexOf(n);
  const iUrl = idx("postUrl");
  const iText = idx("postContent");
  const iAuthorUrl = idx("authorUrl");
  const iProfileUrl = idx("profileUrl");
  const iLikes = idx("likeCount");
  const iComments = idx("commentCount");
  const iReposts = idx("repostCount");
  const iViews = idx("viewCount");
  const iTimestamp = idx("postTimestamp");
  const iImg = idx("imgUrl");
  if (iUrl < 0 || iText < 0) {
    r.error = "LinkedIn CSV missing postUrl/postContent columns.";
    return r;
  }

  const conns = await prisma.platformConnection.findMany({
    where: { platform: Platform.LINKEDIN, isEnabled: true },
    select: { id: true, clientId: true, externalAccountUrl: true, client: { select: { name: true } } },
  });
  const vanityMap = new Map<string, { connId: string; clientId: string; name: string }>();
  for (const c of conns) {
    const m = (c.externalAccountUrl || "").toLowerCase().match(/linkedin\.com\/(?:company|in|school)\/([^/?#]+)/i);
    if (m) vanityMap.set(m[1].toLowerCase(), { connId: c.id, clientId: c.clientId, name: c.client.name });
  }

  const byClient = new Map<string, { conn: { connId: string; clientId: string; name: string }; vanity: string; rows: typeof rows }>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const url = (row[iUrl] ?? "").trim();
    const text = (row[iText] ?? "").trim();
    if (!url || !text) continue;
    const author = ((iAuthorUrl >= 0 && row[iAuthorUrl]) || (iProfileUrl >= 0 && row[iProfileUrl]) || "").toLowerCase();
    let vanity: string | null = null;
    const am = author.match(/linkedin\.com\/(?:company|in|school)\/([^/?#]+)/i);
    if (am) vanity = am[1].toLowerCase();
    else {
      const um = url.toLowerCase().match(/linkedin\.com\/(?:company|in|school)\/([^/?#]+)/i);
      if (um) vanity = um[1].toLowerCase();
    }
    if (!vanity) continue;
    const conn = vanityMap.get(vanity);
    if (!conn) continue;
    r.rowsMatched++;
    let slot = byClient.get(vanity);
    if (!slot) { slot = { conn, vanity, rows: [] }; byClient.set(vanity, slot); }
    slot.rows.push(row);
  }
  r.clientsMatched = byClient.size;

  for (const [vanity, slot] of byClient) {
    const trimmed = slot.rows
      .map((row) => {
        const url = (row[iUrl] ?? "").trim();
        const text = (row[iText] ?? "").trim();
        const ts = iTimestamp >= 0 ? (row[iTimestamp] ?? "").trim() : "";
        const aMatch = url.match(/activity[:-](\d{10,})/);
        let pubAt: Date | null = null;
        if (ts) {
          const d = new Date(ts.replace("Z", "+00:00"));
          if (!isNaN(d.getTime())) pubAt = d;
        }
        return {
          externalPostId: aMatch ? aMatch[1] : url,
          postUrl: url,
          postTextSnippet: text.slice(0, 280),
          hasMedia: iImg >= 0 ? !!(row[iImg] ?? "").trim() : false,
          publishedAtUtc: pubAt ?? new Date(),
          likeCount: parseInt(row[iLikes] || "0", 10) || 0,
          commentCount: parseInt(row[iComments] || "0", 10) || 0,
          shareCount: parseInt(row[iReposts] || "0", 10) || 0,
          viewCount: iViews >= 0 ? (parseInt(row[iViews] || "0", 10) || 0) : 0,
        };
      })
      .filter((p) => !!p.externalPostId)
      .sort((a, b) => b.publishedAtUtc.getTime() - a.publishedAtUtc.getTime())
      .slice(0, 25);
    let upserted = 0;
    for (const p of trimmed) {
      try {
        const dateLocal = p.publishedAtUtc.toISOString().slice(0, 10);
        await prisma.socialPost.upsert({
          where: {
            clientId_platform_externalPostId: {
              clientId: slot.conn.clientId,
              platform: Platform.LINKEDIN,
              externalPostId: p.externalPostId,
            },
          },
          create: {
            clientId: slot.conn.clientId,
            platformConnectionId: slot.conn.connId,
            platform: Platform.LINKEDIN,
            externalPostId: p.externalPostId,
            postUrl: p.postUrl,
            postTextSnippet: p.postTextSnippet,
            hasMedia: p.hasMedia,
            publishedAtUtc: p.publishedAtUtc,
            publishedAtLocal: p.publishedAtUtc,
            publishedDateLocal: dateLocal,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            shareCount: p.shareCount,
            viewCount: p.viewCount,
            rawPayloadJson: JSON.stringify({ source: "pb-import-latest" }),
          },
          update: {
            postTextSnippet: p.postTextSnippet,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            shareCount: p.shareCount,
            viewCount: p.viewCount,
          },
        });
        upserted++;
      } catch {}
    }
    r.postsUpserted += upserted;
    r.perClient.push({ name: slot.conn.name, vanity, count: upserted });
    try {
      await prisma.platformConnection.update({
        where: { id: slot.conn.connId },
        data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
      });
    } catch {}
  }

  return r;
}

export async function GET(req: NextRequest) {
  // Auth: same Bearer CRON_SECRET pattern as other cron endpoints.
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (auth) {
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: "Phantombuster is not configured. Add the API key in /settings." }, { status: 400 });
    }
    const url = new URL(req.url);
    const onlyParam = url.searchParams.get("platform");

    const perPlatform: PlatformReport[] = [];
    if (config.twitterPhantomId && (!onlyParam || onlyParam === "TWITTER")) {
      perPlatform.push(await importTwitter(config.apiKey, config.twitterPhantomId));
    }
    if (config.linkedinPhantomId && (!onlyParam || onlyParam === "LINKEDIN")) {
      perPlatform.push(await importLinkedIn(config.apiKey, config.linkedinPhantomId));
    }
    return NextResponse.json({ success: true, data: { perPlatform } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "import failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
