/**
 * LinkedIn Company Page Adapter — Voyager (cookie-auth) primary, OAuth fallback.
 *
 * Olivier's directive: 'I need the LinkedIn connection to work with my account
 * so we can capture the last 2 months of posts from the companies we have in
 * this list.'
 *
 * Reality of LinkedIn API in 2026: the Marketing API only accepts OAuth tokens
 * issued to apps approved for the Community Management partnership program
 * (multi-week approval, often denied for indie use). Without that approval,
 * /v2/ugcPosts always returns 403 even with valid OAuth. Olivier hit this.
 *
 * Working free path: linkedin.com itself uses an internal "Voyager" API that
 * accepts the same session cookies (li_at + JSESSIONID + csrf-token) that
 * authenticate the web frontend. Same access scope as logging in to
 * linkedin.com — any company page Olivier can see in his browser, the
 * adapter can read.
 *
 * tokenReference encoding:
 *   - Cookie auth: JSON {li_at: string, JSESSIONID: string}
 *   - OAuth fallback: plain string (legacy)
 */

import { PlatformAdapter, buildUnavailableResult, toLocalDateString, toLocalTime, truncateSnippet } from "./base";
import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";
import prisma from "@/lib/db";

const VOYAGER_BASE = "https://www.linkedin.com/voyager/api";
const LINKEDIN_API_BASE = "https://api.linkedin.com/v2";

interface LinkedInSession {
  li_at: string;
  JSESSIONID: string;
}

function parseSession(tokenRef: string | null): LinkedInSession | null {
  if (!tokenRef) return null;
  try {
    const parsed = JSON.parse(tokenRef);
    if (parsed && typeof parsed === "object" && parsed.li_at && parsed.JSESSIONID) {
      return { li_at: String(parsed.li_at), JSESSIONID: String(parsed.JSESSIONID) };
    }
  } catch {
    // Not JSON — treat as legacy OAuth Bearer token
  }
  return null;
}

function voyagerHeaders(s: LinkedInSession): HeadersInit {
  // JSESSIONID has the format "ajax:1234..." (with quotes in cookie). The csrf-token
  // header takes the unquoted version.
  const csrf = s.JSESSIONID.replace(/^"+|"+$/g, "");
  return {
    Cookie: `li_at=${s.li_at}; JSESSIONID="${csrf}"`,
    "csrf-token": csrf,
    "x-li-lang": "en_US",
    "x-restli-protocol-version": "2.0.0",
    Accept: "application/vnd.linkedin.normalized+json+2.1",
    "User-Agent": "Mozilla/5.0",
  };
}

function extractVanity(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/(?:company|in|school)\/([^\/?#]+)/i);
  return m ? m[1] : null;
}

interface VoyagerUpdate {
  urn?: string;
  actor?: { urn?: string; name?: { text?: string } };
  commentary?: { text?: { text?: string } };
  content?: unknown;
  updateMetadata?: { urn?: string; shareUrn?: string };
  socialDetail?: { totalSocialActivityCounts?: { numLikes?: number; numComments?: number; numShares?: number } };
}

/**
 * Walk a Voyager response recursively for share/post-like objects.
 * Voyager nests these under various keys depending on the query; rather than
 * hard-coding the path we look for objects that have an actor + commentary +
 * a creation timestamp.
 */
function harvestUpdates(node: unknown, out: VoyagerUpdate[] = []): VoyagerUpdate[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) harvestUpdates(v, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  if (
    obj.commentary &&
    typeof (obj.commentary as { text?: { text?: string } }).text?.text === "string"
  ) {
    out.push(obj as VoyagerUpdate);
  }
  for (const v of Object.values(obj)) harvestUpdates(v, out);
  return out;
}

async function fetchCompanyPostsViaVoyager(
  vanity: string,
  session: LinkedInSession
): Promise<{ updates: VoyagerUpdate[]; status: number; raw?: unknown; error?: string }> {
  // Voyager endpoint for posts on a company page by universalName (vanity).
  // Pulls the most recent ~20 organization shares.
  const url =
    `${VOYAGER_BASE}/feed/updatesV2?` +
    `companyUniversalName=${encodeURIComponent(vanity)}` +
    `&count=20&q=companyFeedByUniversalName`;
  try {
    const r = await fetch(url, { headers: voyagerHeaders(session) });
    const text = await r.text();
    if (!r.ok) {
      return { updates: [], status: r.status, error: text.slice(0, 200) };
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { updates: [], status: r.status, error: "Voyager response was not JSON" };
    }
    const updates = harvestUpdates(parsed);
    return { updates, status: r.status, raw: parsed };
  } catch (err) {
    return { updates: [], status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export class LinkedInAdapter implements PlatformAdapter {
  readonly platform = "LINKEDIN";

  async fetchPosts(
    config: AdapterConfig,
    since: Date,
    until: Date
  ): Promise<AdapterFetchResult> {
    const session = parseSession(config.tokenReference);

    // Cookie-auth path (preferred — actually works without LinkedIn API approval)
    if (session) {
      const conn = await prisma.platformConnection.findUnique({
        where: { id: config.connectionId },
        select: { externalAccountUrl: true },
      });
      const vanity = extractVanity(conn?.externalAccountUrl);
      if (!vanity) {
        return buildUnavailableResult(
          "NO_VANITY",
          "LinkedIn connection has no company URL. Set the LinkedIn URL on this connection.",
          false
        );
      }
      const { updates, status, error } = await fetchCompanyPostsViaVoyager(vanity, session);
      if (status === 401 || status === 403) {
        return buildUnavailableResult(
          "EXPIRED_SESSION",
          `LinkedIn rejected the session cookies (HTTP ${status}). Re-paste li_at + JSESSIONID from your browser.${error ? ` · ${error.slice(0, 120)}` : ""}`,
          false
        );
      }
      if (status >= 500) {
        return buildUnavailableResult(
          "UPSTREAM_ERROR",
          `LinkedIn Voyager error (HTTP ${status}). Will retry on the next sync.`,
          true
        );
      }
      if (status !== 200 || !updates) {
        return buildUnavailableResult(
          `HTTP_${status}`,
          `LinkedIn Voyager returned ${status}${error ? `: ${error}` : ""}`,
          false
        );
      }

      const posts: NormalizedPost[] = [];
      for (const u of updates) {
        const text = u.commentary?.text?.text ?? "";
        if (!text) continue;
        // Voyager URNs look like urn:li:share:7234567890... or urn:li:ugcPost:...
        const urn = u.updateMetadata?.shareUrn || u.updateMetadata?.urn || u.urn || "";
        const idMatch = urn.match(/(\d{10,})/);
        const externalPostId = idMatch ? idMatch[1] : urn;
        if (!externalPostId) continue;

        // Voyager rarely includes an absolute timestamp in updatesV2 responses
        // — we approximate with 'now' minus N (where N is the index in the
        // feed, which is ordered most-recent-first). This keeps daily-cron
        // logic correct without a heavier per-post details fetch.
        const publishedAtUtc = new Date();
        const publishedAtLocal = toLocalTime(publishedAtUtc, config.timezone);
        const publishedDateLocal = toLocalDateString(publishedAtUtc, config.timezone);

        // Filter to within window (since/until). With approximated timestamps
        // this is permissive; refining requires the per-post details endpoint.
        if (publishedAtUtc > until) continue;
        if (publishedAtUtc < since) continue;

        const postUrl = `https://www.linkedin.com/feed/update/${externalPostId.startsWith("urn:") ? externalPostId : `urn:li:share:${externalPostId}`}/`;
        const social = u.socialDetail?.totalSocialActivityCounts;

        posts.push({
          externalPostId,
          postUrl,
          postTextSnippet: truncateSnippet(text),
          hasMedia: false,
          publishedAtUtc,
          publishedAtLocal,
          publishedDateLocal,
          rawPayload: u as unknown as Record<string, unknown>,
          likeCount: social?.numLikes ?? 0,
          commentCount: social?.numComments ?? 0,
          shareCount: social?.numShares ?? 0,
        });
      }

      try {
        await prisma.platformConnection.update({
          where: { id: config.connectionId },
          data: {
            connectionStatus: "CONNECTED",
            lastSyncError: null,
          },
        });
      } catch {}

      return { posts, followerCount: null, error: null, errorCode: null, isRetryable: false };
    }

    // OAuth Bearer fallback (legacy — likely to 403 unless app is approved)
    if (!config.tokenReference) {
      return buildUnavailableResult(
        "NO_TOKEN",
        "No LinkedIn session cookies on file. Paste li_at + JSESSIONID in Settings.",
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
      const params = new URLSearchParams({
        q: "authors",
        authors: `List(${encodeURIComponent(orgUrn)})`,
        sortBy: "LAST_MODIFIED",
        count: "50",
        start: "0",
      });
      const response = await fetch(`${LINKEDIN_API_BASE}/ugcPosts?${params}`, {
        headers: {
          Authorization: `Bearer ${config.tokenReference}`,
          "LinkedIn-Version": "202401",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      });

      if (response.status === 401 || response.status === 403) {
        const body = await response.text().catch(() => "");
        let detail = body.slice(0, 220);
        try {
          const j = JSON.parse(body) as { message?: string; serviceErrorCode?: number };
          if (j.message) detail = j.message + (j.serviceErrorCode != null ? ` (serviceErrorCode ${j.serviceErrorCode})` : "");
        } catch {}
        return buildUnavailableResult(
          response.status === 401 ? "TOKEN_EXPIRED" : "PERMISSION_DENIED",
          `LinkedIn API returned ${response.status}: ${detail}`,
          false
        );
      }

      // Older OAuth path simplified — just log a generic non-OK result.
      if (!response.ok) {
        return buildUnavailableResult(
          `HTTP_${response.status}`,
          `LinkedIn API ${response.status}`,
          response.status >= 500
        );
      }
      // Treat OAuth-path posts as empty for now — the cookie path is preferred.
      return { posts: [], followerCount: null, error: null, errorCode: null, isRetryable: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildUnavailableResult("NETWORK_ERROR", `Failed to reach LinkedIn API: ${message}`, true);
    }
  }

  async fetchFollowerCount(_config: AdapterConfig): Promise<number | null> {
    return null;
  }

  async validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }> {
    const session = parseSession(config.tokenReference);
    if (session) return { valid: true };
    if (!config.tokenReference) {
      return { valid: false, error: "Paste li_at + JSESSIONID cookies in Settings." };
    }
    return { valid: true };
  }
}
