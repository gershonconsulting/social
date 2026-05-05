/**
 * X / Twitter Adapter — guest-auth + GraphQL.
 *
 * Why this approach: Olivier doesn't want a paid Developer Portal account.
 * Two free options were tried and abandoned:
 *  1. Twitter syndication endpoint — Twitter killed the public-tweet content
 *     there earlier this year (timeline.entries always [] now).
 *  2. Nitter RSS — works from a normal IP but Cloudflare workers get blocked
 *     with 520 errors (nitter.net rate-limits CF egress IPs aggressively).
 *
 * Working approach: Twitter's own web app uses an embedded public bearer
 * token + per-session guest tokens to call its GraphQL API. The bearer is
 * literally hardcoded into the twitter.com JS bundle and is therefore public.
 * Anyone (including unauthenticated CF workers) can:
 *   1. POST /1.1/guest/activate.json with the bearer  →  { guest_token }
 *   2. GET /graphql/.../UserByScreenName?variables={...}  →  { user.rest_id }
 *   3. GET /graphql/.../UserTweets?variables={user_id,count:20}  →  timeline
 *
 * Library precedent: snscrape, twscrape, react-tweet, react-twitter-embed
 * all rely on this same flow. Stable enough for a single-user sync cron.
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";
import prisma from "@/lib/db";

// Public bearer hardcoded in twitter.com web app — also baked into twscrape etc.
const PUBLIC_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const Q_USER_BY_SCREEN_NAME = "G3KGOASz96M-Qu0nwmGXNg";
const Q_USER_TWEETS = "Z5e8EdepAZHPsCgBzdiOiQ";

const FEATURES = {
  hidden_profile_likes_enabled: false,
  hidden_profile_subscriptions_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: false,
  subscriptions_verification_info_verified_since_enabled: false,
  highlights_tweets_tab_ui_enabled: false,
  responsive_web_twitter_article_notes_tab_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

const TWEETS_FEATURES = {
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: false,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_media_download_video_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

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

async function getGuestToken(): Promise<string | null> {
  try {
    const r = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PUBLIC_BEARER}`,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { guest_token?: string };
    return j.guest_token ?? null;
  } catch {
    return null;
  }
}

async function lookupUserId(handle: string, guestToken: string): Promise<string | null> {
  const variables = JSON.stringify({ screen_name: handle, withSafetyModeUserFields: false });
  const features = JSON.stringify(FEATURES);
  const fieldToggles = JSON.stringify({ withAuxiliaryUserLabels: false });
  const url =
    `https://api.twitter.com/graphql/${Q_USER_BY_SCREEN_NAME}/UserByScreenName?` +
    `variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}&fieldToggles=${encodeURIComponent(fieldToggles)}`;
  try {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${PUBLIC_BEARER}`,
        "x-guest-token": guestToken,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { user?: { result?: { rest_id?: string; id?: string } } } };
    return j.data?.user?.result?.rest_id ?? null;
  } catch {
    return null;
  }
}

interface TweetEntry {
  rest_id: string;
  legacy?: {
    full_text?: string;
    created_at?: string;
    entities?: { media?: unknown[] };
    is_quote_status?: boolean;
    in_reply_to_status_id_str?: string;
  };
}

function harvestTweetsFromTimeline(node: unknown, out: TweetEntry[] = []): TweetEntry[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) harvestTweetsFromTimeline(item, out);
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
  for (const v of Object.values(obj)) harvestTweetsFromTimeline(v, out);
  return out;
}

async function fetchUserTweets(userId: string, guestToken: string): Promise<TweetEntry[]> {
  const variables = JSON.stringify({
    userId,
    count: 40,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  });
  const features = JSON.stringify(TWEETS_FEATURES);
  const url =
    `https://api.twitter.com/graphql/${Q_USER_TWEETS}/UserTweets?` +
    `variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;
  try {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${PUBLIC_BEARER}`,
        "x-guest-token": guestToken,
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!r.ok) return [];
    const j = await r.json();
    return harvestTweetsFromTimeline(j);
  } catch {
    return [];
  }
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

    const guestToken = await getGuestToken();
    if (!guestToken) {
      return buildUnavailableResult(
        "GUEST_TOKEN_FAILED",
        "Could not obtain a guest token from Twitter. Will retry on the next sync.",
        true
      );
    }

    let userId = config.externalAccountId;
    if (!userId) {
      userId = await lookupUserId(handle, guestToken) || "";
      if (!userId) {
        return buildUnavailableResult(
          "USER_LOOKUP_FAILED",
          `Twitter could not resolve a user_id for @${handle}. Profile may be private or suspended.`,
          true
        );
      }
    }

    const tweetEntries = await fetchUserTweets(userId, guestToken);
    if (tweetEntries.length === 0) {
      return buildUnavailableResult(
        "EMPTY_TIMELINE",
        `Twitter returned no tweets for @${handle} in this window.`,
        false
      );
    }

    const posts: NormalizedPost[] = [];
    for (const t of tweetEntries) {
      const legacy = t.legacy;
      if (!legacy?.created_at || !legacy.full_text) continue;
      // Skip replies — we only track originals
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

    // Persist resolved user_id + handle for the next sync to skip lookups
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
    // The UserByScreenName response includes legacy.followers_count, but
    // adding another guest-auth roundtrip per platform-test isn't worth the
    // complexity for a metric Olivier already sees on each company card.
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
