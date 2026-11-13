/**
 * THE count of "posts collected on a day" (nightly 2026-11-13, v4.77.3).
 * Pure (no database) so a unit test can prove every report gets the same number.
 *
 * Definition, used by every Social report e-mail (digest, Collection Report,
 * Competitive report):
 *   - Day: the America/New_York calendar day the post was STORED in the Social
 *     app (social_posts."createdAt" = when it was collected), not when it was
 *     published on LinkedIn / X.
 *   - Deduped: one post = one (company, platform, external post id). The
 *     database's unique index already enforces this today; counting distinct
 *     keys here means a future duplicate path can never inflate a report.
 *   - Scope: whatever rows the caller loaded (the Gershon workspace by default,
 *     see ./collection-counts).
 *
 * Why this exists: the Collection Report's headline came from a SQL
 * `"createdAt" AT TIME ZONE 'America/New_York'` bucket. "createdAt" is a
 * timestamp WITHOUT time zone holding UTC, and on such a column AT TIME ZONE
 * converts the wrong way (it reads the value AS New York time), so the "ET day"
 * was really [19:00 UTC day-before, 19:00 UTC) — ten hours off. The digest and
 * the per-company lists used a correct [00:00 ET, 00:00 ET) window, hence
 * 76 vs 20 posts for Nov 10 from the same build. Bucketing now happens here,
 * in JS with Intl, for every report.
 */
import { BUSINESS_TZ } from "./et-days";

export const COLLECTION_DAY_DEFINITION =
  "posts stored (collected) in the Social app during the America/New_York calendar day, deduped by company + platform + post id, Gershon workspace companies only";

export interface CollectedPost {
  clientId: string;
  platform: string;
  externalPostId: string;
  createdAt: Date | string;
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
  clientName?: string | null;
  category?: string | null;
}

export interface CollectionDay {
  day: string; // "2026-11-04" (ET)
  posts: number;
  companies: number;
  engagement: number;
  linkedin: number;
  twitter: number;
}

export interface CollectionCompany {
  id: string;
  name: string;
  category: string;
  n: number;
  linkedin: number;
  twitter: number;
}

export interface CollectionCount {
  day: CollectionDay;
  perCompany: CollectionCompany[];
}

const ET_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** The ET calendar day ("YYYY-MM-DD") an instant falls on. */
export function etDayOf(d: Date | string): string {
  return ET_KEY.format(typeof d === "string" ? new Date(d) : d);
}

export function emptyCollectionDay(day: string): CollectionDay {
  return { day, posts: 0, companies: 0, engagement: 0, linkedin: 0, twitter: 0 };
}

const postKey = (p: CollectedPost) => `${p.clientId}|${p.platform}|${p.externalPostId}`;

/** The deduped posts collected on ET day `dayKey` (first stored copy wins). */
export function postsCollectedOn<T extends CollectedPost>(rows: T[], dayKey: string): T[] {
  const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of sorted) {
    const k = postKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    if (etDayOf(p.createdAt) === dayKey) out.push(p);
  }
  return out;
}

/** THE shared count: posts + companies (+ breakdowns) collected on one ET day. */
export function countCollected(rows: CollectedPost[], dayKey: string): CollectionCount {
  const posts = postsCollectedOn(rows, dayKey);
  const day = emptyCollectionDay(dayKey);
  const byCompany = new Map<string, CollectionCompany>();
  for (const p of posts) {
    day.posts++;
    day.engagement += (p.likeCount ?? 0) + (p.commentCount ?? 0) + (p.shareCount ?? 0);
    if (p.platform === "LINKEDIN") day.linkedin++;
    if (p.platform === "TWITTER") day.twitter++;
    let c = byCompany.get(p.clientId);
    if (!c) {
      c = { id: p.clientId, name: p.clientName ?? p.clientId, category: p.category ?? "CLIENT", n: 0, linkedin: 0, twitter: 0 };
      byCompany.set(p.clientId, c);
    }
    c.n++;
    if (p.platform === "LINKEDIN") c.linkedin++;
    if (p.platform === "TWITTER") c.twitter++;
  }
  day.companies = byCompany.size;
  return { day, perCompany: Array.from(byCompany.values()) };
}

/** Per-ET-day counts for each key in `dayKeys`, via countCollected. */
export function countCollectedByDay(rows: CollectedPost[], dayKeys: string[]): Map<string, CollectionDay> {
  const map = new Map<string, CollectionDay>();
  for (const k of dayKeys) map.set(k, countCollected(rows, k).day);
  return map;
}
