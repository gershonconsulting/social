/**
 * Google Business Profile Adapter
 *
 * Uses the Google My Business API (v4) and Business Profile APIs
 * to verify local posts ("Google Posts") published to a business location.
 *
 * Required scopes:
 *   https://www.googleapis.com/auth/business.manage
 *
 * externalAccountId: Google location name (e.g. "accounts/123/locations/456")
 * tokenReference: OAuth2 access token (refreshed as needed)
 *
 * Note: Google Business Profile does not expose a public post URL consistently.
 * We store the internal post name and clearly label this limitation.
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

interface GBPLocalPost {
  name: string;
  languageCode?: string;
  summary?: string;
  callToAction?: { actionType: string; url?: string };
  createTime?: string;
  updateTime?: string;
  topicType?: string;
  state?: string;
  media?: unknown[];
}

interface GBPLocalPostsResponse {
  localPosts?: GBPLocalPost[];
  nextPageToken?: string;
}

export class GoogleBusinessAdapter implements PlatformAdapter {
  readonly platform = "GOOGLE_BUSINESS";

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
        "No Google Business Profile OAuth token configured. Please reconnect the Google account.",
        false
      );
    }

    if (!config.externalAccountId) {
      return buildUnavailableResult(
        "NO_ACCOUNT_ID",
        "No Google Business Profile location ID configured.",
        false
      );
    }

    try {
      const locationName = config.externalAccountId; // e.g. "accounts/123/locations/456"
      const response = await fetch(
        `${GBP_API_BASE}/${locationName}/localPosts?pageSize=100`,
        { headers: this.authHeaders(config.tokenReference) }
      );

      if (response.status === 401) {
        return buildUnavailableResult(
          "TOKEN_EXPIRED",
          "Google API returned 401. OAuth token may be expired. Please reconnect.",
          false
        );
      }

      if (response.status === 403) {
        return buildUnavailableResult(
          "PERMISSION_DENIED",
          "Google API returned 403. Location permissions may be insufficient.",
          false
        );
      }

      if (response.status === 429) {
        return buildUnavailableResult(
          "RATE_LIMITED",
          "Google Business Profile API quota exceeded. Will retry later.",
          true
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return buildUnavailableResult(
          `HTTP_${response.status}`,
          `Google Business Profile API error ${response.status}: ${body.slice(0, 200)}`,
          response.status >= 500
        );
      }

      const data: GBPLocalPostsResponse = await response.json();
      const posts: NormalizedPost[] = [];

      for (const post of data.localPosts ?? []) {
        if (post.state === "REJECTED" || post.state === "REMOVED") continue;

        const createdRaw = post.createTime ?? post.updateTime;
        if (!createdRaw) continue;

        const publishedAtUtc = new Date(createdRaw);
        if (publishedAtUtc < since || publishedAtUtc > until) continue;

        const publishedAtLocal = toLocalTime(publishedAtUtc, config.timezone);
        const publishedDateLocal = toLocalDateString(publishedAtUtc, config.timezone);

        // Google Business Profile does not reliably expose public post URLs.
        // We store the CTA URL when available, or label as unavailable.
        const postUrl = post.callToAction?.url ?? null;

        // Use the post name as the external ID (stable identifier)
        const externalPostId = post.name;

        posts.push({
          externalPostId,
          postUrl,
          postTextSnippet: truncateSnippet(post.summary),
          hasMedia: (post.media?.length ?? 0) > 0,
          publishedAtUtc,
          publishedAtLocal,
          publishedDateLocal,
          rawPayload: post as unknown as Record<string, unknown>,
        });
      }

      return { posts, followerCount: null, error: null, errorCode: null, isRetryable: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildUnavailableResult(
        "NETWORK_ERROR",
        `Failed to reach Google Business Profile API: ${message}`,
        true
      );
    }
  }

  async fetchFollowerCount(_config: AdapterConfig): Promise<number | null> {
    // Google Business Profile does not expose a follower count equivalent.
    // Some metrics (impressions, searches) may be available via the Insights API
    // but are not a follower count. Return null to be transparent.
    return null;
  }

  async validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    if (!config.tokenReference) {
      return { valid: false, error: "No OAuth token configured" };
    }

    try {
      // Attempt to list accounts as a basic token validation
      const response = await fetch(
        `${GBP_API_BASE}/accounts`,
        { headers: this.authHeaders(config.tokenReference) }
      );

      if (response.status === 401) return { valid: false, error: "Token expired or invalid" };
      if (response.status === 403) return { valid: false, error: "Insufficient permissions" };
      if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }
}
