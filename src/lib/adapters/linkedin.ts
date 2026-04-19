/**
 * LinkedIn Company Page Adapter
 *
 * Uses the LinkedIn Marketing API (v2) to fetch organization shares/posts
 * and follower statistics, including engagement metrics (likes, comments, shares).
 *
 * Required OAuth scopes:
 *   r_organization_social, r_organization_followers, rw_organization_admin
 *
 * Token storage: tokenReference in PlatformConnection stores the OAuth access token.
 * Organization ID: externalAccountId in PlatformConnection.
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";

const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";

interface LinkedInPost {
  id: string;
  created: { time: number };
  specificContent?: {
    "com.linkedin.ugc.ShareContent"?: {
      shareCommentary?: { text: string };
      shareMediaCategory?: string;
      media?: { originalUrl?: string }[];
    };
  };
  content?: { contentEntities?: { entityLocation?: string }[] };
  firstPublishedAt?: number;
}

interface LinkedInSharesResponse {
  elements: LinkedInPost[];
  paging?: { start: number; count: number; total: number };
}

interface SocialActionSummary {
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

export class LinkedInAdapter implements PlatformAdapter {
  readonly platform = "LINKEDIN";

  /**
   * Fetch engagement stats (likes, comments, shares) for a given post URN.
   */
  private async fetchSocialActions(
    postUrn: string,
    token: string
  ): Promise<SocialActionSummary> {
    const defaults = { likeCount: 0, commentCount: 0, shareCount: 0 };
    try {
      const encodedUrn = encodeURIComponent(postUrn);

      // Fetch likes count
      const likesResp = await fetch(
        `${LINKEDIN_API_BASE}/socialActions/${encodedUrn}/likes?count=0`,
        { headers: { Authorization: `Bearer ${token}`, "LinkedIn-Version": "202401" } }
      );
      let likes = 0;
      if (likesResp.ok) {
        const likesData = await likesResp.json();
        likes = likesData.paging?.total ?? 0;
      }

      // Fetch comments count
      const commentsResp = await fetch(
        `${LINKEDIN_API_BASE}/socialActions/${encodedUrn}/comments?count=0`,
        { headers: { Authorization: `Bearer ${token}`, "LinkedIn-Version": "202401" } }
      );
      let comments = 0;
      if (commentsResp.ok) {
        const commentsData = await commentsResp.json();
        comments = commentsData.paging?.total ?? 0;
      }

      return { likeCount: likes, commentCount: comments, shareCount: 0 };
    } catch {
      return defaults;
    }
  }

  async fetchPosts(
    config: AdapterConfig,
    since: Date,
    until: Date
  ): Promise<AdapterFetchResult> {
    if (!config.tokenReference) {
      return buildUnavailableResult(
        "NO_TOKEN",
        "No LinkedIn access token configured. Please reconnect the LinkedIn account.",
        false
      );
    }

    if (!config.externalAccountId) {
      return buildUnavailableResult(
        "NO_ACCOUNT_ID",
        "No LinkedIn organization ID configured.",
        false
      );
    }

    try {
      const orgUrn = `urn:li:organization:${config.externalAccountId}`;
      const allPosts: NormalizedPost[] = [];
      let start = 0;
      const pageSize = 50;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({
          q: "authors",
          authors: `List(${encodeURIComponent(orgUrn)})`,
          sortBy: "LAST_MODIFIED",
          count: String(pageSize),
          start: String(start),
        });

        const response = await fetch(`${LINKEDIN_API_BASE}/ugcPosts?${params}`, {
          headers: {
            Authorization: `Bearer ${config.tokenReference}`,
            "LinkedIn-Version": "202401",
            "X-Restli-Protocol-Version": "2.0.0",
          },
        });

        if (response.status === 401 || response.status === 403) {
          return buildUnavailableResult(
            response.status === 401 ? "TOKEN_EXPIRED" : "PERMISSION_DENIED",
            `LinkedIn API returned ${response.status}. Token may be expired or permissions insufficient.`,
            false
          );
        }

        if (response.status === 429) {
          return buildUnavailableResult(
            "RATE_LIMITED",
            "LinkedIn API rate limit reached. Will retry later.",
            true
          );
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          return buildUnavailableResult(
            `HTTP_${response.status}`,
            `LinkedIn API error ${response.status}: ${body.slice(0, 200)}`,
            response.status >= 500
          );
        }

        const data: LinkedInSharesResponse = await response.json();

        for (const element of data.elements ?? []) {
          const publishedTimestamp = element.firstPublishedAt ?? element.created?.time;
          if (!publishedTimestamp) continue;

          const publishedAtUtc = new Date(publishedTimestamp);
          // Skip posts outside range; stop paging if we've passed the since boundary
          if (publishedAtUtc > until) continue;
          if (publishedAtUtc < since) {
            hasMore = false;
            break;
          }

          const publishedAtLocal = toLocalTime(publishedAtUtc, config.timezone);
          const publishedDateLocal = toLocalDateString(publishedAtUtc, config.timezone);

          const shareContent = element.specificContent?.["com.linkedin.ugc.ShareContent"];
          const textSnippet = truncateSnippet(shareContent?.shareCommentary?.text);
          const hasMedia = (shareContent?.media?.length ?? 0) > 0;

          const postUrl = `https://www.linkedin.com/feed/update/${element.id}/`;

          // Fetch engagement metrics
          const engagement = await this.fetchSocialActions(element.id, config.tokenReference!);

          allPosts.push({
            externalPostId: element.id,
            postUrl,
            postTextSnippet: textSnippet,
            hasMedia,
            publishedAtUtc,
            publishedAtLocal,
            publishedDateLocal,
            likeCount: engagement.likeCount,
            commentCount: engagement.commentCount,
            shareCount: engagement.shareCount,
            rawPayload: element as unknown as Record<string, unknown>,
          });
        }

        // Check if there are more pages
        const total = data.paging?.total ?? 0;
        start += pageSize;
        if (start >= total || (data.elements?.length ?? 0) < pageSize) {
          hasMore = false;
        }
      }

      return { posts: allPosts, followerCount: null, error: null, errorCode: null, isRetryable: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildUnavailableResult("NETWORK_ERROR", `Failed to reach LinkedIn API: ${message}`, true);
    }
  }

  async fetchFollowerCount(config: AdapterConfig): Promise<number | null> {
    if (!config.tokenReference || !config.externalAccountId) return null;

    try {
      const orgUrn = encodeURIComponent(`urn:li:organization:${config.externalAccountId}`);
      const response = await fetch(
        `${LINKEDIN_API_BASE}/networkSizes/${orgUrn}?edgeType=CompanyFollowedByMember`,
        {
          headers: {
            Authorization: `Bearer ${config.tokenReference}`,
            "LinkedIn-Version": "202401",
          },
        }
      );

      if (!response.ok) return null;
      const data = await response.json();
      return data.firstDegreeSize ?? null;
    } catch {
      return null;
    }
  }

  async validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    if (!config.tokenReference) {
      return { valid: false, error: "No access token configured" };
    }

    try {
      const response = await fetch(`${LINKEDIN_API_BASE}/me`, {
        headers: { Authorization: `Bearer ${config.tokenReference}` },
      });

      if (response.status === 401) return { valid: false, error: "Token expired or invalid" };
      if (response.status === 403) return { valid: false, error: "Insufficient permissions" };
      if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }
}
