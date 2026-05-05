/**
 * X / Twitter Adapter — public-syndication mode.
 *
 * Olivier's directive: 'I don't want to use the paid developer program from
 * twitter. Use my personal account to review the pages and collect the
 * information. It is only for me this platform!'
 *
 * Approach: fetch the same public syndication endpoint that powers Twitter's
 * embeddable widgets. No auth, no Bearer token, no Developer Portal account.
 * Works for any public profile.
 *
 * Endpoint:
 *   GET https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}
 *
 * Response: HTML page that embeds a <script id="__NEXT_DATA__"> tag with the
 * full timeline payload as JSON. We extract that JSON and walk it for tweets.
 *
 * Limitations:
 *  - Returns ~20-25 most recent tweets (good enough for daily sync windows).
 *  - Works only for PUBLIC accounts. Protected accounts can't be scraped.
 *  - Twitter rate-limits per IP; for a single-user platform syncing ~10
 *    accounts/day this is comfortably below the threshold.
 *  - Follower count is not exposed by syndication; we read it from the same
 *    HTML if Twitter renders it, otherwise return null.
 *
 * Storage: tokenReference and externalAccountId are NOT required. The handle
 * is taken from externalAccountUrl or externalAccountName.
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";
import prisma from "@/lib/db";

const SYNDICATION_BASE = "https://syndication.twitter.com/srv/timeline-profile/screen-name";

type SyndicationTweet = {
  id_str?: string;
  created_at?: string;
  full_text?: string;
  text?: string;
  entities?: {
    media?: Array<unknown>;
  };
  user?: {
    id_str?: string;
    screen_name?: string;
    name?: string;
    followers_count?: number;
  };
};

/**
 * Resolve the @handle for a connection from URL or display name.
 */
async function resolveHandle(config: AdapterConfig): Promise<string | null> {
  // Already cached?
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
 * Extract the __NEXT_DATA__ JSON blob from a syndication HTML response.
 */
function extractNextData(html: string): unknown | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Walk a parsed __NEXT_DATA__ object and pull out tweet objects.
 * The shape changes; rather than hard-code one path we recursively look for
 * objects with id_str + created_at + (full_text|text), which is the unique
 * signature of a Twitter status.
 */
function harvestTweets(node: unknown, out: SyndicationTweet[] = []): SyndicationTweet[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) harvestTweets(item, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (
    typeof obj.id_str === "string" &&
    typeof obj.created_at === "string" &&
    (typeof obj.full_text === "string" || typeof obj.text === "string")
  ) {
    out.push(obj as SyndicationTweet);
  }
  for (const v of Object.values(obj)) harvestTweets(v, out);
  return out;
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
      const url = `${SYNDICATION_BASE}/${encodeURIComponent(handle)}`;
      const r = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });

      if (r.status === 404) {
        return buildUnavailableResult(
          "NOT_FOUND",
          `X profile @${handle} not found.`,
          false
        );
      }
      if (r.status === 401 || r.status === 403) {
        return buildUnavailableResult(
          "PROTECTED_OR_BLOCKED",
          "X returned forbidden — the profile may be protected or Twitter blocked the request.",
          false
        );
      }
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        return buildUnavailableResult(
          `HTTP_${r.status}`,
          `X syndication error ${r.status}: ${body.slice(0, 200)}`,
          r.status >= 500
        );
      }

      const html = await r.text();
      const nextData = extractNextData(html);
      if (!nextData) {
        return buildUnavailableResult(
          "PARSE_FAILED",
          "Could not parse the X syndication response. Twitter may have changed the page format.",
          true
        );
      }

      const tweets = harvestTweets(nextData);
      const posts: NormalizedPost[] = [];

      for (const tw of tweets) {
        if (!tw.id_str || !tw.created_at) continue;
        const publishedAtUtc = new Date(tw.created_at);
        if (Number.isNaN(publishedAtUtc.getTime())) continue;
        // Window filter
        if (publishedAtUtc < since || publishedAtUtc > until) continue;

        const text = tw.full_text || tw.text || "";
        const publishedAtLocal = toLocalTime(publishedAtUtc, config.timezone);
        const publishedDateLocal = toLocalDateString(publishedAtUtc, config.timezone);
        const postUrl = `https://x.com/${handle}/status/${tw.id_str}`;

        posts.push({
          externalPostId: tw.id_str,
          postUrl,
          postTextSnippet: truncateSnippet(text),
          hasMedia: Array.isArray(tw.entities?.media) && (tw.entities!.media!.length > 0),
          publishedAtUtc,
          publishedAtLocal,
          publishedDateLocal,
          rawPayload: tw as unknown as Record<string, unknown>,
        });
      }

      // Persist the resolved handle as externalAccountId/Name (one less lookup later)
      try {
        await prisma.platformConnection.update({
          where: { id: config.connectionId },
          data: { externalAccountId: handle, externalAccountName: handle },
        });
      } catch {
        // non-fatal
      }

      // Try to extract follower count from the response if Twitter rendered it
      const firstUser = tweets.find((t) => t.user?.followers_count != null)?.user;
      const followerCount = firstUser?.followers_count ?? null;

      return { posts, followerCount, error: null, errorCode: null, isRetryable: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildUnavailableResult("NETWORK_ERROR", `Failed to reach X syndication: ${message}`, true);
    }
  }

  async fetchFollowerCount(config: AdapterConfig): Promise<number | null> {
    // Syndication endpoint embeds follower count alongside tweets — easiest is
    // to call fetchPosts with a tight window and read the count it captured.
    const handle = await resolveHandle(config);
    if (!handle) return null;
    try {
      const r = await fetch(`${SYNDICATION_BASE}/${encodeURIComponent(handle)}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!r.ok) return null;
      const html = await r.text();
      const nextData = extractNextData(html);
      if (!nextData) return null;
      const tweets = harvestTweets(nextData);
      const firstUser = tweets.find((t) => t.user?.followers_count != null)?.user;
      return firstUser?.followers_count ?? null;
    } catch {
      return null;
    }
  }

  async validateConnection(_config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    // Public-syndication mode has no token to validate. The handle resolution
    // happens lazily in fetchPosts.
    return { valid: true };
  }
}
