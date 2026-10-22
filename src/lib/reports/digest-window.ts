/**
 * Which posts belong in the daily digest's "last 24 hours" — by PUBLISH date.
 *
 * Audit 2026-10-22: the 21 Oct digest listed a Meteor Biotech post from April
 * 2024 under "Top posts" because the digest selected posts by INGESTION time
 * (social_posts.createdAt). A first collection of a company back-fills months
 * of old posts, so "ingested in the last 24h" is not "posted in the last 24h".
 *
 * Rules (pure, unit-tested in tests/report-logic.test.ts):
 *   - "window"  : publishedAtUtc is inside [from, to]   → counted as last 24h.
 *   - "older"   : publishedAtUtc is before `from`       → collected in this run,
 *                 shown separately as back-fill, never as last 24h.
 *   - "unknown" : no publish date, an invalid one, one in the future, or one
 *                 stamped at ingestion. The ingest route falls back to
 *                 `new Date()` when the page gave no date
 *                 (src/app/api/extension/ingest/route.ts), so a publish time at
 *                 or after the row's createdAt (minus a 2-minute tolerance)
 *                 means "we do not know when this was published". Listed
 *                 separately, never as last 24h.
 */

export type DigestBucket = "window" | "older" | "unknown";

/** A post whose publish time is this close to (or after) its ingestion was stamped by the ingest fallback. */
export const INGEST_STAMP_TOLERANCE_MS = 2 * 60 * 1000;

export interface DigestPostDates {
  createdAt: Date | string | null | undefined;
  publishedAtUtc: Date | string | null | undefined;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function classifyDigestPost(p: DigestPostDates, window: { from: Date; to: Date }): DigestBucket {
  const published = toDate(p.publishedAtUtc);
  if (!published) return "unknown";
  // Published after the report was generated: a parsing error, not a fact.
  if (published.getTime() > window.to.getTime() + 5 * 60 * 1000) return "unknown";
  const created = toDate(p.createdAt);
  if (created && published.getTime() >= created.getTime() - INGEST_STAMP_TOLERANCE_MS) return "unknown";
  if (published.getTime() >= window.from.getTime()) return "window";
  return "older";
}

/** Split posts into the three buckets, preserving order inside each. */
export function splitDigestPosts<T extends DigestPostDates>(
  posts: T[],
  window: { from: Date; to: Date },
): { window: T[]; older: T[]; unknown: T[] } {
  const out = { window: [] as T[], older: [] as T[], unknown: [] as T[] };
  for (const p of posts) out[classifyDigestPost(p, window)].push(p);
  return out;
}
