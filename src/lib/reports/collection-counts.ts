/**
 * ONE definition of "posts collected on a day", shared by the two daily
 * collection e-mails (nightly 2026-11-07):
 *
 *   - "Social Collection Report"       (src/lib/reports/daily-report.ts)
 *   - "Report social.gershonCRM.com"   (src/app/api/digest/daily/route.ts)
 *
 * Before, they disagreed for the same day (11-04: 23 posts / 14 companies vs
 * 19 / 11; 11-03: 30 / 18 vs 27 / 16) because they counted two different
 * things: the Collection Report counted every workspace for the
 * America/New_York day, while the digest counted only the Gershon workspace for
 * the rolling 24 hours before it was sent (~20:00 UTC) and printed the send
 * date.
 *
 * The definition now used by both:
 *   - Day boundary: the America/New_York calendar day, [00:00 ET, next 00:00 ET)
 *     (see ./et-days; DST-safe).
 *   - Moment counted: when the post was first stored in the Social app
 *     (social_posts."createdAt"), i.e. when it was collected, not when it was
 *     published on LinkedIn / X.
 *   - Scope: companies of ONE workspace, the Gershon workspace (primary
 *     organization) by default, the same scope as v4.65.2's digest fix, so
 *     client workspaces' companies and competitors never inflate Gershon's
 *     numbers.
 *   - Companies: distinct companies (clients) with at least one such post.
 */
import prisma from "@/lib/db";
import { etDayKey, etDayShort, etMidnight } from "./et-days";
export { COLLECTION_DEFINITION, DEFAULT_WORKSPACE, workspaceLabel, reportSubject, postsFromCompanies, sourceFreshnessLine } from "./report-subject";

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

export function emptyCollectionDay(day: string): CollectionDay {
  return { day, posts: 0, companies: 0, engagement: 0, linkedin: 0, twitter: 0 };
}

/** The ET day `daysAgo` days back (1 = yesterday) as the window both e-mails count. */
export function collectionWindow(daysAgo = 1, now: Date = new Date()) {
  return {
    from: etMidnight(daysAgo, now),
    to: etMidnight(daysAgo - 1, now),
    dayKey: etDayKey(daysAgo, now),
    dayShort: etDayShort(daysAgo, now),
  };
}

/** Per-ET-day counts for [from, to) — `from`/`to` must be ET midnights. */
export async function collectionByDay(orgId: string, from: Date, to: Date): Promise<Map<string, CollectionDay>> {
  const rows = await prisma.$queryRaw<Array<{
    day: string;
    posts: number;
    companies: number;
    engagement: number;
    linkedin: number;
    twitter: number;
  }>>`
    SELECT to_char((p."createdAt" AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS day,
           count(*)::int AS posts,
           count(DISTINCT p."clientId")::int AS companies,
           coalesce(sum(p."likeCount" + p."commentCount" + p."shareCount"), 0)::int AS engagement,
           count(*) FILTER (WHERE p.platform::text = 'LINKEDIN')::int AS linkedin,
           count(*) FILTER (WHERE p.platform::text = 'TWITTER')::int AS twitter
      FROM social_posts p
      JOIN clients c ON c.id = p."clientId"
     WHERE p."createdAt" >= ${from} AND p."createdAt" < ${to}
       AND c."organizationId" = ${orgId}
     GROUP BY 1
  `;
  const map = new Map<string, CollectionDay>();
  for (const r of rows) {
    map.set(r.day, {
      day: r.day,
      posts: Number(r.posts),
      companies: Number(r.companies),
      engagement: Number(r.engagement),
      linkedin: Number(r.linkedin),
      twitter: Number(r.twitter),
    });
  }
  return map;
}

/** Per-company counts for [from, to), same definition and scope. */
export async function collectionPerCompany(orgId: string, from: Date, to: Date): Promise<CollectionCompany[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; category: string; n: number; linkedin: number; twitter: number }>>`
    SELECT c.id AS id, c.name AS name, c."clientType"::text AS category, count(*)::int AS n,
           count(*) FILTER (WHERE p.platform::text = 'LINKEDIN')::int AS linkedin,
           count(*) FILTER (WHERE p.platform::text = 'TWITTER')::int AS twitter
      FROM social_posts p
      JOIN clients c ON c.id = p."clientId"
     WHERE p."createdAt" >= ${from} AND p."createdAt" < ${to}
       AND c."organizationId" = ${orgId}
     GROUP BY 1, 2, 3
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    n: Number(r.n),
    linkedin: Number(r.linkedin),
    twitter: Number(r.twitter),
  }));
}

/** Headline counts for one ET day, derived from the per-company rows. */
export function totalsOf(perCompany: CollectionCompany[]): { posts: number; companies: number } {
  return {
    posts: perCompany.reduce((s, c) => s + c.n, 0),
    companies: perCompany.filter((c) => c.n > 0).length,
  };
}
