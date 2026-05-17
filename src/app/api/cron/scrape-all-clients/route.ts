export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

/**
 * GET /api/cron/scrape-all-clients
 *
 * For every ACTIVE client with a configured LinkedIn or X URL, make ONE
 * authenticated call to the platform using the cookies the Watchman Chrome
 * extension captured. Upsert each post into SocialPost.
 *
 * Triggered by:
 *   - GitHub Actions daily at 06:00 UTC (with Authorization: Bearer CRON_SECRET)
 *   - Or by the Watchman extension popup right after Sync Now (no auth — same
 *     origin, lightweight, allowed)
 *   - Or manually from the dashboard
 */

interface CookieBundle { cookies: Record<string,string>; capturedAt: string | null; }

async function loadCookies(platform: "LINKEDIN" | "TWITTER"): Promise<CookieBundle> {
  const row = await prisma.setting.findUnique({ where: { key: `cookies:${platform}` } });
  if (!row) return { cookies: {}, capturedAt: null };
  try {
    const parsed = JSON.parse(row.value) as CookieBundle;
    return { cookies: parsed.cookies ?? {}, capturedAt: parsed.capturedAt ?? null };
  } catch { return { cookies: {}, capturedAt: null }; }
}
function cookieHeader(c: Record<string,string>) { return Object.entries(c).map(([k,v]) => `${k}=${v}`).join("; "); }
function activityIdFromUrl(url: string): string {
  const m = url.match(/activity[:-](\d{10,})/);
  return m ? m[1] : url;
}

interface ScrapeResult {
  client: string;
  clientId: string;
  platform: string;
  url: string;
  upserted: number;
  status: number;
  error?: string;
}

// ============================================================
// LinkedIn — pull the company posts via Voyager organizationShareFeed
// ============================================================
async function scrapeLinkedInOne(
  clientId: string,
  connectionId: string,
  clientName: string,
  url: string,
  cookies: Record<string,string>,
): Promise<ScrapeResult> {
  const res: ScrapeResult = { client: clientName, clientId, platform: "LINKEDIN", url, upserted: 0, status: 0 };
  if (!cookies.li_at) { res.error = "no LinkedIn cookies on file"; return res; }
  // Extract vanity name from URL: /company/<vanity>
  const m = url.match(/linkedin\.com\/(?:company|in)\/([a-zA-Z0-9\-_.]+)/);
  if (!m) { res.error = "couldn't parse vanity from URL"; return res; }
  const vanity = m[1];
  // Step 1: resolve company URN
  const headers = {
    Cookie: cookieHeader(cookies),
    "csrf-token": (cookies.JSESSIONID || "").replace(/"/g, ""),
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "x-restli-protocol-version": "2.0.0",
  };
  // CRITICAL: redirect:'manual' so we don't follow the 302 → /login chain
  // when Voyager rejects auth. Without this, Cloudflare worker burns through
  // redirects until it bails with "Too many redirects".
  const fetchOpts: RequestInit = { headers, redirect: "manual" as const };
  let orgUrn: string | null = null;
  try {
    const r = await fetch(`https://www.linkedin.com/voyager/api/organization/companies?q=universalName&universalName=${encodeURIComponent(vanity)}`, fetchOpts);
    res.status = r.status;
    if (r.ok) {
      const j = await r.json() as { elements?: Array<{ entityUrn?: string }> };
      const urn = j.elements?.[0]?.entityUrn;
      if (urn) orgUrn = urn.replace(/^urn:li:company:/, "");
    } else {
      res.error = `Voyager universalName HTTP ${r.status}`;
      return res;
    }
  } catch (e) { res.error = e instanceof Error ? e.message : String(e); return res; }
  if (!orgUrn) { res.error = "company not found via universalName"; return res; }

  // Step 2: pull posts for that org
  try {
    const feedUrl = `https://www.linkedin.com/voyager/api/feed/updates?count=25&moduleKey=organization-shares&q=organizationShareFeed&organizationalPage=urn:li:fs_organization:${orgUrn}`;
    const r = await fetch(feedUrl, fetchOpts);
    res.status = r.status;
    if (!r.ok) { res.error = `Voyager feed HTTP ${r.status}`; return res; }
    const j = await r.json() as { elements?: Array<unknown> };
    const elements = j.elements ?? [];
    // Each element has a "updateMetadata.urn" with the activity URN + nested commentary
    type UpdateEl = {
      updateMetadata?: { urn?: string };
      commentary?: { text?: { text?: string } };
      content?: { _type?: string };
      socialDetail?: { totalSocialActivityCounts?: { numLikes?: number; numComments?: number; numShares?: number } };
      actor?: { name?: { text?: string } };
    };
    const ops = [];
    for (const e0 of elements) {
      try {
        const e = e0 as UpdateEl;
        const urn = e.updateMetadata?.urn;
        if (!urn) continue;
        const activityId = activityIdFromUrl(urn);
        const text = e.commentary?.text?.text;
        if (!text) continue;
        const counts = e.socialDetail?.totalSocialActivityCounts ?? {};
        ops.push({
          where: { clientId_platform_externalPostId: { clientId, platform: Platform.LINKEDIN, externalPostId: activityId } },
          create: {
            clientId, platformConnectionId: connectionId, platform: Platform.LINKEDIN,
            externalPostId: activityId,
            postUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`,
            postTextSnippet: text.slice(0, 280),
            hasMedia: !!e.content,
            publishedAtUtc: new Date(),
            publishedAtLocal: new Date(),
            publishedDateLocal: new Date().toISOString().slice(0,10),
            likeCount: Number(counts.numLikes ?? 0),
            commentCount: Number(counts.numComments ?? 0),
            shareCount: Number(counts.numShares ?? 0),
            rawPayloadJson: JSON.stringify({ source: "voyager-organizationShareFeed", raw: e0 }),
          },
          update: {
            postTextSnippet: text.slice(0, 280),
            likeCount: Number(counts.numLikes ?? 0),
            commentCount: Number(counts.numComments ?? 0),
            shareCount: Number(counts.numShares ?? 0),
          },
        });
      } catch {}
    }
    if (ops.length > 0) {
      await prisma.$transaction(ops.map((o) => prisma.socialPost.upsert(o)));
      res.upserted = ops.length;
    }
    try {
      await prisma.platformConnection.update({
        where: { id: connectionId },
        data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
      });
    } catch {}
  } catch (e) { res.error = e instanceof Error ? e.message : String(e); }
  return res;
}

// ============================================================
// X / Twitter — user_timeline via web API
// ============================================================
async function scrapeTwitterOne(
  clientId: string,
  connectionId: string,
  clientName: string,
  url: string,
  cookies: Record<string,string>,
): Promise<ScrapeResult> {
  const res: ScrapeResult = { client: clientName, clientId, platform: "TWITTER", url, upserted: 0, status: 0 };
  if (!cookies.auth_token || !cookies.ct0) { res.error = "no X cookies on file"; return res; }
  const m = url.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,20})/);
  if (!m) { res.error = "couldn't parse handle from URL"; return res; }
  const handle = m[1];
  const headers: Record<string,string> = {
    Cookie: cookieHeader(cookies),
    "x-csrf-token": cookies.ct0,
    Authorization: "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  };
  try {
    const r = await fetch(
      `https://api.x.com/1.1/statuses/user_timeline.json?screen_name=${encodeURIComponent(handle)}&count=50&include_rts=false&tweet_mode=extended`,
      { headers }
    );
    res.status = r.status;
    if (!r.ok) { res.error = `Timeline HTTP ${r.status}`; return res; }
    const tweets = await r.json() as Array<{ id_str?: string; full_text?: string; text?: string; created_at?: string; favorite_count?: number; reply_count?: number; retweet_count?: number; entities?: unknown }>;
    const ops = [];
    for (const t of tweets) {
      const id = t.id_str;
      const text = t.full_text || t.text;
      const createdAt = t.created_at ? new Date(t.created_at) : new Date();
      if (!id || !text) continue;
      ops.push({
        where: { clientId_platform_externalPostId: { clientId, platform: Platform.TWITTER, externalPostId: id } },
        create: {
          clientId, platformConnectionId: connectionId, platform: Platform.TWITTER,
          externalPostId: id,
          postUrl: `https://x.com/${handle}/status/${id}`,
          postTextSnippet: text.slice(0, 280),
          hasMedia: false,
          publishedAtUtc: createdAt,
          publishedAtLocal: createdAt,
          publishedDateLocal: createdAt.toISOString().slice(0,10),
          likeCount: Number(t.favorite_count ?? 0),
          commentCount: Number(t.reply_count ?? 0),
          shareCount: Number(t.retweet_count ?? 0),
          rawPayloadJson: JSON.stringify({ source: "x-user_timeline", raw: t }),
        },
        update: {
          postTextSnippet: text.slice(0, 280),
          publishedAtUtc: createdAt,
          publishedAtLocal: createdAt,
          publishedDateLocal: createdAt.toISOString().slice(0,10),
          likeCount: Number(t.favorite_count ?? 0),
          commentCount: Number(t.reply_count ?? 0),
          shareCount: Number(t.retweet_count ?? 0),
        },
      });
    }
    if (ops.length > 0) {
      await prisma.$transaction(ops.map((o) => prisma.socialPost.upsert(o)));
      res.upserted = ops.length;
    }
    try {
      await prisma.platformConnection.update({
        where: { id: connectionId },
        data: { connectionStatus: "CONNECTED", lastSyncError: null, lastSyncAt: new Date() },
      });
    } catch {}
  } catch (e) { res.error = e instanceof Error ? e.message : String(e); }
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (auth && secret && auth !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Cloudflare Workers cap us at ~50 subrequests per invocation. Each
    // client × platform uses up to 2 fetches (URN lookup + feed), so we
    // limit to a small batch and chunk via offset/limit. The daily cron
    // calls this endpoint multiple times (offset=0,5,10,...).
    const sp = req.nextUrl.searchParams;
    const offset = Math.max(0, parseInt(sp.get("offset") || "0", 10));
    const limit = Math.min(10, Math.max(1, parseInt(sp.get("limit") || "5", 10)));

    const liData = await loadCookies("LINKEDIN");
    const twData = await loadCookies("TWITTER");

    const clients = await prisma.client.findMany({
      where: { status: "ACTIVE" },
      include: {
        platformConnections: {
          where: { isEnabled: true, platform: { in: [Platform.LINKEDIN, Platform.TWITTER] }, externalAccountUrl: { not: null } },
          select: { id: true, platform: true, externalAccountUrl: true },
        },
      },
      orderBy: { name: "asc" },
      skip: offset,
      take: limit,
    });
    const totalClients = await prisma.client.count({ where: { status: "ACTIVE" } });

    const results: ScrapeResult[] = [];

    // Process sequentially to be polite to LinkedIn/X
    for (const c of clients) {
      for (const conn of c.platformConnections) {
        const url = conn.externalAccountUrl ?? "";
        if (!url) continue;
        let r: ScrapeResult;
        if (conn.platform === Platform.LINKEDIN) {
          r = await scrapeLinkedInOne(c.id, conn.id, c.name, url, liData.cookies);
        } else {
          r = await scrapeTwitterOne(c.id, conn.id, c.name, url, twData.cookies);
        }
        results.push(r);
        // Tiny pause to avoid rate-limit
        await new Promise((res) => setTimeout(res, 200));
      }
    }

    const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
    const failed = results.filter((r) => r.error).length;

    return NextResponse.json({
      success: true,
      data: {
        totalUpserted,
        totalAttempts: results.length,
        failed,
        results,
        offset,
        limit,
        totalClients,
        hasMore: offset + clients.length < totalClients,
        nextOffset: offset + clients.length < totalClients ? offset + clients.length : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "scrape failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
