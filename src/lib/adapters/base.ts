import { AdapterConfig, AdapterFetchResult, NormalizedPost } from "@/types";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

/**
 * Base interface all platform adapters must implement.
 */
export interface PlatformAdapter {
  readonly platform: string;
  /**
   * Fetch posts published on or after `since` and on or before `until`.
   * Must normalize results into NormalizedPost[].
   */
  fetchPosts(config: AdapterConfig, since: Date, until: Date): Promise<AdapterFetchResult>;

  /**
   * Fetch current follower count.
   * Returns null when the platform does not expose this metric.
   */
  fetchFollowerCount(config: AdapterConfig): Promise<number | null>;

  /**
   * Validate that the stored token/credentials are still valid.
   */
  validateConnection(config: AdapterConfig): Promise<{ valid: boolean; error?: string }>;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Convert a UTC timestamp to a local date string (YYYY-MM-DD) in the given timezone.
 */
export function toLocalDateString(utcDate: Date, timezone: string): string {
  return formatInTimeZone(utcDate, timezone, "yyyy-MM-dd");
}

/**
 * Convert a UTC timestamp to the local zoned time.
 */
export function toLocalTime(utcDate: Date, timezone: string): Date {
  return toZonedTime(utcDate, timezone);
}

/**
 * Build a standard "unknown" result when a platform API is unavailable.
 */
export function buildUnavailableResult(
  errorCode: string,
  errorMessage: string,
  isRetryable: boolean
): AdapterFetchResult {
  return {
    posts: [],
    followerCount: null,
    error: errorMessage,
    errorCode,
    isRetryable,
  };
}

/**
 * Truncate post text to a sensible snippet length.
 */
export function truncateSnippet(text: string | null | undefined, maxLength = 280): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + "…" : cleaned;
}
