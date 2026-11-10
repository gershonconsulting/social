/**
 * Did the actions move anything? (v4.70.0)
 *
 * For every card marked done in the last 14 days that names one of the
 * workspace's own companies, compare that company's posts in the 7 days after
 * the action with its usual week (the 28 days before it): how many posts, and
 * how much engagement each one got. Plain numbers, no claim of cause — the
 * point is that the client sees the tool's work next to its results.
 */
import rawDb from "@/lib/db-raw";
import { readCards, type ActionCard, type Pillar } from "./store";

const DAY = 86400000;

export type CardResult = {
  card: ActionCard;
  postsAfter: number;
  postsPerWeekBefore: number;
  engagementPerPostAfter: number | null;
  engagementPerPostBefore: number | null;
  /** Fewer than 7 days since it was done: still counting. */
  inProgress: boolean;
};

export type ActionResults = {
  window: { from: string; to: string };
  created: number;
  done: number;
  dismissed: number;
  open: number;
  byPillar: Record<Pillar, { created: number; done: number }>;
  results: CardResult[];
};

export async function buildResults(orgId: string, now = new Date()): Promise<ActionResults> {
  const cards = await readCards(orgId);
  const since = new Date(now.getTime() - 7 * DAY);
  const recent = cards.filter((c) => new Date(c.createdAt) >= since);
  const byPillar: ActionResults["byPillar"] = { PROMOTE: { created: 0, done: 0 }, NETWORK: { created: 0, done: 0 }, ENGAGE: { created: 0, done: 0 } };
  for (const c of recent) {
    byPillar[c.pillar].created++;
    if (c.status === "done") byPillar[c.pillar].done++;
  }

  const doneRecent = cards
    .filter((c) => c.status === "done" && c.doneAt && c.forCompanyId && now.getTime() - new Date(c.doneAt).getTime() <= 14 * DAY)
    .slice(0, 12);

  const results: CardResult[] = [];
  for (const card of doneRecent) {
    const doneAt = new Date(card.doneAt!);
    const afterEnd = new Date(Math.min(now.getTime(), doneAt.getTime() + 7 * DAY));
    const beforeStart = new Date(doneAt.getTime() - 28 * DAY);
    try {
      const posts = await rawDb.socialPost.findMany({
        where: { organizationId: orgId, clientId: card.forCompanyId!, publishedAtUtc: { gte: beforeStart, lt: afterEnd } },
        select: { publishedAtUtc: true, likeCount: true, commentCount: true, shareCount: true },
        take: 2000,
      });
      const before = posts.filter((p) => p.publishedAtUtc < doneAt);
      const after = posts.filter((p) => p.publishedAtUtc >= doneAt);
      const eng = (ps: typeof posts) => (ps.length ? Math.round(ps.reduce((s, p) => s + p.likeCount + p.commentCount + p.shareCount, 0) / ps.length) : null);
      results.push({
        card,
        postsAfter: after.length,
        postsPerWeekBefore: Math.round((before.length / 4) * 10) / 10,
        engagementPerPostAfter: eng(after),
        engagementPerPostBefore: eng(before),
        inProgress: now.getTime() - doneAt.getTime() < 7 * DAY,
      });
    } catch {
      /* one company's numbers must not stop the rest */
    }
  }

  return {
    window: { from: since.toISOString(), to: now.toISOString() },
    created: recent.length,
    done: recent.filter((c) => c.status === "done").length,
    dismissed: recent.filter((c) => c.status === "dismissed").length,
    open: recent.filter((c) => c.status === "open").length,
    byPillar,
    results,
  };
}
