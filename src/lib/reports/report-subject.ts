/**
 * Pure helpers (no database) shared by the daily social report e-mails:
 * one subject format and one "Source + freshness" footer line
 * (nightly 2026-11-07). Counting lives in ./collection-counts.
 */
import { BUSINESS_TZ } from "./et-days";

export { COLLECTION_DAY_DEFINITION as COLLECTION_DEFINITION } from "./collection-day";
import { COLLECTION_DAY_DEFINITION } from "./collection-day";

/** Digest title. v4.77.3: the app's real domain (was "Report social.gershonCRM.com"). Sender name unchanged. */
export const DIGEST_TITLE = "Report social.gershon.ai";

// ── One subject format for the daily social e-mails ─────────────────────────
// "<Title> — <Workspace> — <Month D, YYYY> — <tail>". The workspace falls back
// to the Gershon workspace's name, so a failed name lookup can no longer drop
// it from the subject (seen on the Intelligence report).
export const DEFAULT_WORKSPACE = "Gershon Consulting";

export function workspaceLabel(workspace?: string | null): string {
  return workspace?.trim() || DEFAULT_WORKSPACE;
}

export function reportSubject(title: string, workspace: string | null | undefined, day: string, tail?: string): string {
  return `${title} — ${workspaceLabel(workspace)} — ${day}${tail ? ` — ${tail}` : ""}`;
}

export function postsFromCompanies(posts: number, companies: number): string {
  return `${posts} ${posts === 1 ? "post" : "posts"} from ${companies} ${companies === 1 ? "company" : "companies"}`;
}

// ── "Source + freshness" footer line ────────────────────────────────────────
export function sourceFreshnessLine(opts: { site: string; dayKey: string; generatedAt: string | Date; extra?: string }): string {
  const asOf = new Date(opts.generatedAt).toLocaleString("en-US", { timeZone: BUSINESS_TZ, dateStyle: "medium", timeStyle: "short" });
  const host = opts.site.replace(/^https?:\/\//, "");
  return `Source: ${host} (Social app database: ${COLLECTION_DAY_DEFINITION}) · Counts for ${opts.dayKey} ET · Data as of ${asOf} ET${opts.extra ? ` · ${opts.extra}` : ""}`;
}
