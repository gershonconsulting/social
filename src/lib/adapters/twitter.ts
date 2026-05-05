/**
 * X / Twitter Adapter — user-session-cookie auth.
 *
 * Olivier's directive: 'I don't want the paid Developer Portal. Use my
 * personal account to review the pages. It is only for me this platform.'
 *
 * History (verified live each time):
 *   - syndication.twitter.com — Twitter killed timeline.entries (always [])
 *   - nitter.net RSS — works from a normal IP, blocked from CF worker IPs
 *   - guest-auth + GraphQL UserTweets — returns empty TimelineClearCache
 *     since Twitter locked it down to authenticated callers only
 *
 * The one approach that still works: hit /graphql/.../UserTweets with the
 * current user's session cookies (auth_token + ct0). User copies these from
 * their browser → we store them in tokenReference → adapter sends them as
 * Cookie + x-csrf-token + Bearer headers.
 *
 * Bundle-hash auto-discovery: Twitter rotates GraphQL queryIds every few
 * weeks. If the pinned hash returns 404, we fetch x.com homepage, parse
 * the main bundle URL out, fetch the bundle, regex out the current queryId,
 * cache it, and retry. Self-healing.
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";
import prisma from "@/lib/db";

const PUBLIC_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

// Pinned query hashes (May 2026). Auto-discovery kicks in if these 404.
let CURRENT_USER_BY_SCREEN_NAME = "IGgvgiOx4QZndDHuD3x9TQ";
let CURRENT_USER_TWEETS = "pQHADmT91zIY83UbK0x4Lw";

const FEATURES_USER = {};
const FEATURES_TWEETS = {};

interface SessionCookies {
  authToken: string;
  ct0: string;
}

function parseSessionCookies(tokenRef: string | null): SessionCookies | null {
  if (!tokenRef) return null;
  try {
    const parsed = JSON.parse(tokenRef);
    if (parsed && typeof parsed === "object" && parsed.authToken && parsed.ct0) {
      return { authToken: String(parsed.authToken), ct0: String(parsed.ct0) };
    }
  } catch {
    // Not JSON — treat as a raw auth_token; ct0 missing makes the call fail
    // but we still surface a clearer error than 'unknown'.
  }
  return null;
}

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
 * Re-discover GraphQL queryIds by scraping the current x.com main bundle.
 */
async function refreshQueryHashes(): Promise<void> {
  try {
    const home = await fetch("https://x.com/", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!home.ok) return;
    const html = await home.text();
    const m = html.match(/(https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-f0-9]+\.js)/);
    if (!m) return;
    const bundle = await fetch(m[1], { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!bundle.ok) return;
    const js = await bundle.text();
    const userByScreenName = js.match(/queryId:"([a-zA-Z0-9_-]{15,30})"[^}]{0,100}operationName:"UserByScreenName"/);
    const userTweets = js.match(/queryId:"([a-zA-Z0-9_-]{15,30})"[^}]{0,100}operationName:"UserTweets"/);
    if (userByScreenName) CURRENT_USER_BY_SCREEN_NAME = userByScreenName[1];
    if (userTweets) CURRENT_USER_TWEETS = userTweets[1];
  } catch {
    // ignore — keep pinned hashes
  }
}

function authHeaders(session: SessionCookies): HeadersInit {
  return {
    Authorization: `Bearer ${PUBLIC_BEARER}`,
    Cookie: `auth_token=${session.authToken}; ct0=${session.ct0}`,
    "x-csrf-token": session.ct0,
    "User-Agent": "Mozilla/5.0",
  };
}

async function lookupUserId(handle: string, session: SessionCookies, retried = false): Promise<string | null> {
  const variables = JSON.stringify({ screen_name: handle, withSafetyModeUserFields: false });
  const features = JSON.stringify(FEATURES_USER);
  const qs =
    `variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;
  const r = await fetch(
    `https://api.twitter.com/graphql/${CURRENT_USER_BY_SCREEN_NAME}/UserByScreenName?${qs}`,
    { headers: authHeaders(session) }
  );
  if (r.status === 404 && !retried) {
    await refreshQueryHashes();
    return lookupUserId(handle, session, true);
  }
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: { user?: { result?: { rest_id?: string } } } };
  return j.data?.user?.result?.rest_id ?? null;
}

interface TweetEntry {
  rest_id: string;
  legacy?: {
    full_text?: string;
    created_at?: string;
    entities?: { media?: unknown[] };
    in_reply_to_status_id_str?: string;
  };
}

function harvestTweets(node: unknown, out: TweetEntry[] = []): TweetEntry[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) harvestTweets(v, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (
    obj.__typename === "Tweet" &&
    typeof obj.rest_id === "string" &&
    obj.legacy &&
    typeof obj.legacy === "object"
  ) {
    out.push(obj as unknown as TweetEntry);
  }
  for (const v of Object.values(obj)) harvestTweets(v, out);
  return out;
}

async function fetchUserTweets(userId: string, session: SessionCookies, retried = false): Promise<{ tweets: TweetEntry[]; status: number; bodyHead?: string }> {
  const variables = JSON.stringify({
    userId,
    count: 40,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  });
  const features = JSON.stringify(FEATURES_TWEETS);
  const qs = `variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;
  const r = await fetch(
    `https://api.twitter.com/graphql/${CURRENT_USER_TWEETS}/UserTweets?${qs}`,
    { headers: authHeaders(session) }
  );
  if (r.status === 404 && !retried) {
    await refreshQueryHashes();
    return fetchUserTweets(userId, session, true);
  }
  if (!r.ok) {
    const bodyHead = (await r.text().catch(() => "")).slice(0, 200);
    return { tweets: [], status: r.status, bodyHead };
  }
  const j = await r.json();
  return { tweets: harvestTweets(j), status: r.status };
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
        "Could not determine the X / Twitter handle. Set the account URL on the connection.",
        false
      );
    }

    const session = parseSessionCookies(config.tokenReference);
    if (!session) {
      return buildUnavailableResult(
        "NO_SESSION",
        "X / Twitter session cookies not configured. Paste auth_token and ct0 from your browser into Settings.",
        false
      );
    }

    let userId = config.externalAccountId;
    if (!userId) {
      userId = (await lookupUserId(handle, session)) || "";
      if (!userId) {
        return buildUnavailableResult(
          "USER_LOOKUP_FAILED",
          `Could not resolve user_id for @${handle}. Token may be invalid or @${handle} doesn't exist.`,
          true
        );
      }
    }

    const { tweets, status, bodyHead } = await fetchUserTweets(userId, session);
    if (tweets.length === 0) {
      const reason =
        status === 401
          ? "X / Twitter rejected the session cookies (401). Re-paste auth_token + ct0 from your browser."
          : status === 403
            ? "X / Twitter blocked the request (403). Account may be locked or suspended."
            : status >= 500
              ? `X / Twitter server error (${status}). Will retry on next sync.`
              : `Twitter returned no tweets for @${handle} in this window.`;
      return buildUnavailableResult(
        status === 401 ? "EXPIRED_SESSION" : status >= 500 ? "UPSTREAM_ERROR" : "EMPTY_TIMELINE",
        reason + (bodyHead ? ` · ${bodyHead}` : ""),
        status >= 500
      );
    }

    const posts: NormalizedPost[] = [];
    for (const t of tweets) {
      const legacy = t.legacy;
      if (!legacy?.created_at || !legacy.full_text) continue;
      if (legacy.in_reply_to_status_id_str) continue;
      const publishedAtUtc = new Date(legacy.created_at);
      if (Number.isNaN(publishedAtUtc.getTime())) continue;
      if (publishedAtUtc < since || publishedAtUtc > until) continue;

      const publishedAtLocal = toLocalTime(publishedAtUtc, config.timezone);
      const publishedDateLocal = toLocalDateString(publishedAtUtc, config.timezone);
      const postUrl = `https://x.com/${handle}/status/${t.rest_id}`;

      posts.push({
        externalPostId: t.rest_id,
        postUrl,
        postTextSnippet: truncateSnippet(legacy.full_text),
        hasMedia: Array.isArray(legacy.entities?.media) && (legacy.entities!.media!.length > 0),
        publishedAtUtc,
        publishedAtLocal,
        publishedDateLocal,
        rawPayload: t as unknown as Record<string, unknown>,
      });
    }

    try {
      await prisma.platformConnection.update({
        where: { id: config.connectionId },
        data: {
          externalAccountId: userId,
          externalAccountName: handle,
          connectionStatus: "CONNECTED",
          lastSyncError: null,
        },
      });
    } catch {
      // non-fatal
    }

    return { posts, followerCount: null, error: null, errorCode: null, isRetryable: false };
  }

  async fetchFollowerCount(_config: AdapterConfig): Promise<number | null> {
    return null;
  }

  async validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    if (!parseSessionCookies(config.tokenReference)) {
      return { valid: false, error: "Paste auth_token + ct0 from your browser into Settings." };
    }
    if (!(await resolveHandle(config))) {
      return { valid: false, error: "Connection has no @handle." };
    }
    return { valid: true };
  }
}
