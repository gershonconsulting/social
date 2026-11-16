/**
 * Parse a LinkedIn page URL into what the collector needs.
 * Showcase pages (linkedin.com/showcase/<vanity>) are their own pages with
 * their own posts; they were silently skipped before 4.79.0 because only
 * company / in / school URLs were recognised.
 */
export type LinkedInPageKind = "company" | "showcase" | "school" | "in";

export function parseLinkedInPage(url: string | null | undefined): { kind: LinkedInPageKind; vanity: string } | null {
  const m = String(url || "").match(/linkedin\.com\/(company|showcase|school|in)\/([^/?#]+)/i);
  if (!m) return null;
  return { kind: m[1].toLowerCase() as LinkedInPageKind, vanity: m[2] };
}
