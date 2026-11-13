/**
 * Database side of the ONE "posts collected on a day" count. The counting
 * itself lives in ./collection-day (countCollected), which every report calls:
 *
 *   - "Social Collection Report"   (src/lib/reports/daily-report.ts)
 *   - "Report social.gershon.ai"   daily digest (src/app/api/digest/daily/route.ts)
 *   - "Competitive report"         (src/lib/reports/ops/competitive.ts)
 *
 * History: nightly 2026-11-07 / PR #24 made both e-mails use the same SQL, but
 * the per-day SQL bucket was ten hours off (see ./collection-day), so the
 * Collection Report headline (76 posts, Nov 10) still disagreed with the digest
 * (20 posts) and with its own per-company list. v4.77.3 loads the rows once and
 * counts them in one pure function.
 *
 * Scope: companies of ONE workspace, the Gershon workspace (primary
 * organization) by default, so client workspaces' companies and competitors
 * never inflate Gershon's numbers.
 */
import prisma from "@/lib/db";
import { etDayKey, etDayShort, etMidnight } from "./et-days";
import { countCollected, type CollectedPost, type CollectionCompany } from "./collection-day";
export { countCollected, countCollectedByDay, emptyCollectionDay, etDayOf, COLLECTION_DAY_DEFINITION } from "./collection-day";
export type { CollectedPost, CollectionCompany, CollectionDay, CollectionCount } from "./collection-day";
export { COLLECTION_DEFINITION, DIGEST_TITLE, DEFAULT_WORKSPACE, workspaceLabel, reportSubject, postsFromCompanies, sourceFreshnessLine } from "./report-subject";

/** The ET day `daysAgo` days back (1 = yesterday) as the window every report counts. */
export function collectionWindow(daysAgo = 1, now: Date = new Date()) {
  return {
    from: etMidnight(daysAgo, now),
    to: etMidnight(daysAgo - 1, now),
    dayKey: etDayKey(daysAgo, now),
    dayShort: etDayShort(daysAgo, now),
  };
}

/**
 * Every post stored in [from, to) for companies of workspace `orgId`. `from`/`to`
 * are instants (ET midnights); the ET-day bucketing happens in countCollected.
 */
export async function loadCollectedPosts(orgId: string, from: Date, to: Date): Promise<CollectedPost[]> {
  const rows = await prisma.socialPost.findMany({
    where: { createdAt: { gte: from, lt: to }, client: { organizationId: orgId } },
    select: {
      clientId: true,
      platform: true,
      externalPostId: true,
      createdAt: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
      client: { select: { name: true, clientType: true } },
    },
  });
  return rows.map((r) => ({
    clientId: r.clientId,
    platform: String(r.platform),
    externalPostId: r.externalPostId,
    createdAt: r.createdAt,
    likeCount: r.likeCount,
    commentCount: r.commentCount,
    shareCount: r.shareCount,
    clientName: r.client?.name ?? null,
    category: r.client?.clientType ? String(r.client.clientType) : null,
  }));
}

/** Headline counts from per-company rows (kept for callers; equals countCollected().day). */
export function totalsOf(perCompany: CollectionCompany[]): { posts: number; companies: number } {
  return {
    posts: perCompany.reduce((s, c) => s + c.n, 0),
    companies: perCompany.filter((c) => c.n > 0).length,
  };
}

/** Convenience: the shared count for the ET day `daysAgo` back (1 = yesterday). */
export async function collectionForDay(orgId: string, daysAgo = 1, now: Date = new Date()) {
  const win = collectionWindow(daysAgo, now);
  const rows = await loadCollectedPosts(orgId, win.from, win.to);
  return { win, rows, count: countCollected(rows, win.dayKey) };
}
