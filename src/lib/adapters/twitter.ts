/**
 * X / Twitter Adapter
 *
 * Uses the Twitter API v2 to fetch tweets from a specified account
 * and follower statistics.
 *
 * Required: Bearer token (app-only) for read access, or OAuth 2.0 user token.
 * externalAccountId: Twitter user ID
 * tokenReference: Bearer token or OAuth access token
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";

const TWITTER_API_BASE = "https://api.twitter.com/2";

interface TwitterTweet {
  id: string;
  text: string;
  created_at: string;
  attachments?: { media_keys?: string[] };
}

interface TwitterUserResponse {
  data?: {
    id: string;
    name: string;
    username: string;
    public_metrics?: { followers_count: number; following_count: number };
  };
}

interface TwitterTweetsResponse {
  data?: TwitterTweet[];
  meta?: { next_token?: string; result_count?: number };
  errors?: { title: string; detail: string }[];
}

export class TwitterAdapter implements PlatformAdapter {
  readonly platform = "TWITTER";

  private authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
  }

  async fetchPosts(
    config: AdapterConfig,
    since: Date,
    until: Date
  ): Promise<AdapterFetchResult> {
    if (!config.tokenReference) {
      return buildUnavailableResult(
        "NO_TOKEN",
        "No X/Twitter Bearer token configured. Please reconnect the X account.",
        false
      );
    }

    if (!config.externalAccountId) {
      return buildUnavailableResult(
        "NO_ACCOUNT_ID",
        "No X/Twitter user ID configured.",
        false
      );
    }

    try {
      const startTime = since.toISOString();
      const endTime = until.toISOString();

      const params = new URLSearchParams({
        max_results: "100",
        start_time: startTime,
        end_time: endTime,
        "tweet.fields": "created_at,text,attachments",
        exclude: "replies,retweets",
      });

      const response = await fetch(
        `${TWITTER_API_BASE}/users/${config.externalAccountId}/tweets?${params}`,
        { headers: this.authHeaders(config.tokenReference) }
      );

      if (response.status === 401) {
        return buildUnavailableResult(
          "TOKEN_EXPIRED",
          "X/Twitter API returned 401. Access token may be expired or invalid.",
          false
        );
      }

      if (response.status === 403) {
        return buildUnavailableResult(
          "PERMISSION_DENIED",
          "X/Twitter API returned 403. Account may have insufficient API access level.",
          false
        );
      }

      if (response.status === 429) {
        return buildUnavailableResult(
          "RATE_LIMITED",
          "X/Twitter API rate limit reached. Will retry after window resets.",
          true
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return buildUnavailableResult(
          `HTTP_${response.status}`,
          `X/Twitter API error ${response.status}: ${body.slice(0, 200)}`,
          response.status >= 500
        );
      }

      const data: TwitterTweetsResponse = await response.json();
      const posts: NormalizedPost[] = [];

      for (const tweet of data.data ?? []) {
        const publishedAtUtc = new Date(tweet.created_at);
        const publishedAtLocal = toLocalTime(publishedAtUtc, config.timezone);
        const publishedDateLocal = toLocalDateString(publishedAtUtc, config.timezone);

        // Build public URL using username if available; fall back to ID-based URL
        const username = config.externalAccountId; // Store username in externalAccountId for cleaner URLs
        const postUrl = `https://x.com/i/web/status/${tweet.id}`;

        posts.push({
          externalPostId: tweet.id,
          postUrl,
          postTextSnippet: truncateSnippet(tweet.text),
          hasMedia: (tweet.attachments?.media_keys?.length ?? 0) > 0,
          publishedAtUtc,
          publishedAtLocal,
          publishedDateLocal,
          rawPayload: tweet as unknown as Record<string, unknown>,
        });
      }

      return { posts, followerCount: null, error: null, errorCode: null, isRetryable: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildUnavailableResult("NETWORK_ERROR", `Failed to reach X/Twitter API: ${message}`, true);
    }
  }

  async fetchFollowerCount(config: AdapterConfig): Promise<number | null> {
    if (!config.tokenReference || !config.externalAccountId) return null;

    try {
      const response = await fetch(
        `${TWITTER_API_BASE}/users/${config.externalAccountId}?user.fields=public_metrics`,
        { headers: this.authHeaders(config.tokenReference) }
      );

      if (!response.ok) return null;
      const data: TwitterUserResponse = await response.json();
      return data.data?.public_metrics?.followers_count ?? null;
    } catch {
      return null;
    }
  }

  async validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    if (!config.tokenReference) {
      return { valid: false, error: "No bearer token configured" };
    }

    try {
      const response = await fetch(`${TWITTER_API_BASE}/users/me`, {
        headers: this.authHeaders(config.tokenReference),
      });

      if (response.status === 401) return { valid: false, error: "Token expired or invalid" };
      if (response.status === 403) return { valid: false, error: "Insufficient API access level" };
      if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }
}
