/**
 * X / Twitter Adapter — Nitter RSS mode.
 *
 * Background: Olivier's directive is no paid Developer Portal account.
 * Twitter killed the unauthenticated syndication endpoint earlier in 2025
 * (HTML still loads, but timeline.entries[] is always empty), so the
 * previous scrape stopped working.
 *
 * Working free alternative: Nitter is an open-source Twitter front-end that
 * exposes RSS at https://{instance}/{handle}/rss with tweet titles, links,
 * and timestamps. Parsing that gives us last ~20 tweets per handle.
 *
 * We use nitter.net as the primary instance; it's the most stable. If a sync
 * call returns 403 (cloudflare bot challenge) or 5xx, we surface the error
 * and the cron retries on the next firing.
 *
 * Storage: tokenReference NOT required. Handle is taken from
 * externalAccountUrl ("https://x.com/{handle}") or externalAccountName.
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";
import prisma from "@/lib/db";

const NITTER_BASE = "https://nitter.net";

async function resolveHandle(config: AdapterConfig): Promise<string | null> {
  try {
    const conn = await prisma.platformConnection.findUnique({
      where: { id: config.connectionId },
      select: { externalAccountUrl: true, externalAccountName: true },
    });
    if (!conn) return null;
    if (conn.externalAccountUrl) {
      const m = conn.externalAccountUrl.match(/(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
      if (m) return m[1];
    }
    if (conn.externalAccountName) {
      const cleaned = conn.externalAccountName.replace(/^@/, "").trim();
      if (/^[A-Za-z0-9_]{1,15}$/.test(cleaned)) return cleaned;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decode XML/HTML entities in RSS content.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)));
}

interface NitterItem {
  tweetId: string;
  text: string;
  publishedAtUtc: Date;
  hasMedia: boolean;
}

/**
 * Parse a Nitter RSS feed into a list of items.
 */
function parseNitterRss(xml: string, handle: string): NitterItem[] {
  const items: NitterItem[] = [];
  // Match each <item>...</item> block
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const linkMatch = block.match(/<link>([^<]+)<\/link>/);
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const dateMatch = block.match(/<pubDate>([^<]+)<\/pubDate>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    if (!linkMatch || !dateMatch) continue;

    const link = linkMatch[1];
    // Status ID is the trailing digits in the URL
    const idMatch = link.match(/\/status\/(\d+)/);
    if (!idMatch) continue;
    const tweetId = idMatch[1];

    let text = titleMatch ? decodeEntities(titleMatch[1]).trim() : "";
    // Strip leading "Username:" or "Display / @handle:" prefix Nitter sometimes adds
    text = text.replace(new RegExp(`^[^:]+/\\s*@${handle}:`, "i"), "").trim();
    text = text.replace(/^R to @[^:]+:\s*/i, "").trim();

    const publishedAtUtc = new Date(dateMatch[1]);
    if (Number.isNaN(publishedAtUtc.getTime())) continue;

    const hasMedia = !!descMatch && /<img|<video/i.test(descMatch[1]);

    items.push({ tweetId, text, publishedAtUtc, hasMedia });
  }
  return items;
}

export class TwitterAdapter implements PlatformAdapter {
  readonly platform = "TWITTER";

  async fetchPosts(
    config: AdapterConfig,
    since: Date,
    until: Date
  ): Promise<AdapterFetchResult> {
    const handle = await resolveHandle(config);
    if (!handle) {
      return buildUnavailableResult(
        "NO_HANDLE",
        "Could not determine the X / Twitter handle for this connection. Set the account URL.",
        false
      );
    }

    try {
      const url = `${NITTER_BASE}/${encodeURIComponent(handle)}/rss`;
      const r = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
        },
        redirect: "follow",
      });

      if (r.status === 404) {
        return buildUnavailableResult(
          "NOT_FOUND",
          `X profile @${handle} not found on Nitter (private or non-existent).`,
          false
        );
      }
      if (r.status === 403) {
        return buildUnavailableResult(
          "BOT_CHALLENGED",
          "Nitter mirror returned a bot-challenge page. Will retry on the next cron tick.",
          true
        );
      }
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return buildUnavailableResult(
          `HTTP_${r.status}`,
          `Nitter mirror error ${r.status}: ${body.slice(0, 200)}`,
          r.status >= 500
        );
      }

      const xml = await r.text();
      if (!xml.includes("<item>")) {
        return buildUnavailableResult(
          "EMPTY_FEED",
          "Nitter returned an empty feed for @" + handle + " (the account may have no recent public tweets).",
          false
        );
      }

      const items = parseNitterRss(xml, handle);
      const posts: NormalizedPost[] = [];

      for (const it of items) {
        if (it.publishedAtUtc < since || it.publishedAtUtc > until) continue;
        const publishedAtLocal = toLocalTime(it.publishedAtUtc, config.timezone);
        const publishedDateLocal = toLocalDateString(it.publishedAtUtc, config.timezone);
        const postUrl = `https://x.com/${handle}/status/${it.tweetId}`;

        posts.push({
          externalPostId: it.tweetId,
          postUrl,
          postTextSnippet: truncateSnippet(it.text),
          hasMedia: it.hasMedia,
          publishedAtUtc: it.publishedAtUtc,
          publishedAtLocal,
          publishedDateLocal,
          rawPayload: { tweetId: it.tweetId, text: it.text } as unknown as Record<string, unknown>,
        });
      }

      // Persist the resolved handle so subsequent calls have it cached
      try {
        await prisma.platformConnection.update({
          where: { id: config.connectionId },
          data: {
            externalAccountId: handle,
            externalAccountName: handle,
            connectionStatus: "CONNECTED",
            lastSyncError: null,
          },
        });
      } catch {
        // non-fatal
      }

      return { posts, followerCount: null, error: null, errorCode: null, isRetryable: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildUnavailableResult("NETWORK_ERROR", `Failed to reach Nitter: ${message}`, true);
    }
  }

  /** Nitter doesn't expose follower counts. */
  async fetchFollowerCount(_config: AdapterConfig): Promise<number | null> {
    return null;
  }

  async validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    const handle = await resolveHandle(config);
    if (!handle) {
      return { valid: false, error: "Connection has no @handle (set the account URL)." };
    }
    return { valid: true };
  }
}
