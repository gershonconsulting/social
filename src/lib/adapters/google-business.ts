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
 * tokenReference: JSON string with { accessToken, refreshToken, expiresAt }
 *   (stored by the Google OAuth callback)
 *
 * Note: Google Business Profile does not expose a public post URL consistently.
 * We store the internal post name and clearly label this limitation.
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";
import prisma from "@/lib/db";

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const GBP_LOCATIONS_API = "https://mybusinessbusinessinformation.googleapis.com/v1";

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

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Parse the tokenReference field which may be:
 * - A JSON string: { accessToken, refreshToken, expiresAt }
 * - A plain access token string (legacy)
 */
function parseToken(tokenReference: string): TokenData {
  try {
    const parsed = JSON.parse(tokenReference);
    if (parsed.accessToken) {
      // Normalize expiresAt — the OAuth callback stores it as an ISO date
      // string, but the rest of this file expects a millisecond timestamp.
      // Without this normalization the "is expired?" comparison was a
      // string < number compare, so refreshes either fired constantly or
      // never fired at all (depending on the date), which silently broke
      // GMB connections after the first hour.
      let expiresAt: number | undefined;
      if (typeof parsed.expiresAt === "number") {
        expiresAt = parsed.expiresAt;
      } else if (typeof parsed.expiresAt === "string" && parsed.expiresAt) {
        const t = Date.parse(parsed.expiresAt);
        if (!Number.isNaN(t)) expiresAt = t;
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken || undefined,
        expiresAt,
      };
    }
    return { accessToken: tokenReference };
  } catch {
    return { accessToken: tokenReference };
  }
}

/**
 * Refresh the Google OAuth access token using the refresh token.
 */
async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
  } catch {
    return null;
  }
}

/**
 * Get a valid access token, refreshing if necessary. When a refresh succeeds
 * AND a connectionId is provided, the new token is persisted back to
 * platformConnection.tokenReference so subsequent calls don't re-refresh.
 *
 * Without persistence, every adapter call would burn a refresh-token use cycle
 * — Google rate-limits this and eventually revokes the refresh token, which
 * was a major contributor to GMB connections silently disconnecting.
 */
async function getAccessToken(tokenRef: string, connectionId?: string): Promise<string | null> {
  const tokenData = parseToken(tokenRef);

  // Check if token is expired (with 5 min buffer)
  const expired = !!tokenData.expiresAt && tokenData.expiresAt < Date.now() + 300_000;

  if (expired) {
    if (!tokenData.refreshToken) {
      return null;
    }
    const refreshed = await refreshAccessToken(tokenData.refreshToken);
    if (!refreshed) return null;

    // Persist the refreshed access token (and existing refresh token) so we
    // don't ask Google for a new one every single call.
    if (connectionId) {
      try {
        await prisma.platformConnection.update({
          where: { id: connectionId },
          data: {
            tokenReference: JSON.stringify({
              accessToken: refreshed.accessToken,
              refreshToken: tokenData.refreshToken,
              expiresAt: refreshed.expiresAt, // ms timestamp
            }),
            tokenExpiresAt: new Date(refreshed.expiresAt),
          },
        });
      } catch {
        // Non-fatal: returning the refreshed token still works for this call.
      }
    }
    return refreshed.accessToken;
  }

  return tokenData.accessToken;
}

export class GoogleBusinessAdapter implements PlatformAdapter {
  readonly platform = "GOOGLE_BUSINESS";

  private authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
  }

  /**
   * Auto-discover the first location for the authenticated account.
   * Used when externalAccountId is not yet set.
   */
  async discoverLocation(tokenReference: string): Promise<{ locationName: string; displayName: string } | null> {
    const accessToken = await getAccessToken(tokenReference);
    if (!accessToken) return null;

    try {
      // Use the new Account Management API to list accounts
      const accountsResp = await fetch(`${GBP_ACCOUNTS_API}/accounts`, {
        headers: this.authHeaders(accessToken),
      });
      if (!accountsResp.ok) {
        // Fallback: try legacy API
        const legacyResp = await fetch(`${GBP_API_BASE}/accounts`, {
          headers: this.authHeaders(accessToken),
        });
        if (!legacyResp.ok) return null;
        const legacyData = await legacyResp.json();
        const accounts = legacyData.accounts ?? [];
        if (accounts.length === 0) return null;
        const accountName = accounts[0].name;
        const locResp = await fetch(`${GBP_API_BASE}/${accountName}/locations`, {
          headers: this.authHeaders(accessToken),
        });
        if (!locResp.ok) return null;
        const locData = await locResp.json();
        const locations = locData.locations ?? [];
        if (locations.length === 0) return null;
        return {
          locationName: locations[0].name,
          displayName: locations[0].locationName || locations[0].name,
        };
      }

      const accountsData = await accountsResp.json();
      const accounts = accountsData.accounts ?? [];
      if (accounts.length === 0) return null;

      // Use the new Business Information API to list locations
      const accountName = accounts[0].name; // e.g. "accounts/123456"
      const locResp = await fetch(
        `${GBP_LOCATIONS_API}/${accountName}/locations?readMask=name,title,storefrontAddress`,
        { headers: this.authHeaders(accessToken) }
      );
      if (!locResp.ok) {
        // Fallback to legacy locations endpoint
        const legacyLocResp = await fetch(`${GBP_API_BASE}/${accountName}/locations`, {
          headers: this.authHeaders(accessToken),
        });
        if (!legacyLocResp.ok) return null;
        const legacyLocData = await legacyLocResp.json();
        const locations = legacyLocData.locations ?? [];
        if (locations.length === 0) return null;
        return {
          locationName: locations[0].name,
          displayName: locations[0].locationName || locations[0].name,
        };
      }

      const locData = await locResp.json();
      const locations = locData.locations ?? [];
      if (locations.length === 0) return null;

      return {
        locationName: locations[0].name,
        displayName: locations[0].title || locations[0].name,
      };
    } catch {
      return null;
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
        "No Google Business Profile OAuth token configured. Please reconnect the Google account.",
        false
      );
    }

    const accessToken = await getAccessToken(config.tokenReference, config.connectionId);
    if (!accessToken) {
      return buildUnavailableResult(
        "TOKEN_EXPIRED",
        "Google OAuth token expired and could not be refreshed. Please reconnect the Google account.",
        false
      );
    }

    if (!config.externalAccountId) {
      return buildUnavailableResult(
        "NO_ACCOUNT_ID",
        "No Google Business Profile location ID configured. Run location discovery first.",
        false
      );
    }

    try {
      const locationName = config.externalAccountId; // e.g. "accounts/123/locations/456"
      const response = await fetch(
        `${GBP_API_BASE}/${locationName}/localPosts?pageSize=100`,
        { headers: this.authHeaders(accessToken) }
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

        const postUrl = post.callToAction?.url ?? null;
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
    return null;
  }

  async validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    if (!config.tokenReference) {
      return { valid: false, error: "No OAuth token configured" };
    }

    const accessToken = await getAccessToken(config.tokenReference, config.connectionId);
    if (!accessToken) {
      return { valid: false, error: "Token expired and could not be refreshed" };
    }

    try {
      // Try new API first, fallback to legacy
      let response = await fetch(
        `${GBP_ACCOUNTS_API}/accounts`,
        { headers: this.authHeaders(accessToken) }
      );
      if (!response.ok) {
        response = await fetch(
          `${GBP_API_BASE}/accounts`,
          { headers: this.authHeaders(accessToken) }
        );
      }

      if (response.status === 401) return { valid: false, error: "Token expired or invalid" };
      if (response.status === 403) return { valid: false, error: "Insufficient permissions" };
      if (!response.ok) return { valid: false, error: `HTTP ${response.status}` };

      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }
}
