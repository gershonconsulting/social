/**
 * Friday client reports (v4.78.0) — loads one client's week from the database:
 * its own posts and the posts of the competitors linked to it in Competitor Watch.
 */
import rawDb from "@/lib/db-raw";
import { etDayKey } from "../et-days";
import { getCompetitorIds } from "@/lib/competitors/store";
import { aboutOf } from "../ops/intelligence";
import { compare, statsFor, type CompanyStats, type Comparison, type FPost, type Role, type Window } from "./analyze";

/** Which companies get the Friday pack: Gershon's campaign clients and clients. */
export const FRIDAY_TYPES = ["CAMPAIGN", "CLIENT"] as const;

export type FridayClient = { id: string; name: string; clientType: string; industry: string | null; about: string | null };

export type FridayData = {
  orgId: string;
  dayKey: string;
  window: Window;
  weekLabel: string;
  client: FridayClient;
  self: CompanyStats;
  competitors: CompanyStats[];
  comparison: Comparison;
  /** This week's posts of the client and its competitors, most engaging first (input for Intelligence). */
  weekPosts: FPost[];
};

export function fridayWindow(now = new Date()): Window {
  return { weekFrom: etDayKey(7, now), weekTo: etDayKey(1, now), prevFrom: etDayKey(14, now), prevTo: etDayKey(8, now) };
}

function label(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
export function weekLabelOf(w: Window): string {
  return `${label(w.weekFrom)} – ${label(w.weekTo)}`;
}

export async function listFridayClients(orgId: string): Promise<FridayClient[]> {
  const rows = await rawDb.client.findMany({
    where: { organizationId: orgId, archivedAt: null, status: { not: "ARCHIVED" }, clientType: { in: [...FRIDAY_TYPES] } },
    select: { id: true, name: true, clientType: true, industry: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, clientType: r.clientType, industry: r.industry, about: aboutOf(r.name, r.industry) }));
}

export async function loadFridayData(orgId: string, clientId: string, now = new Date()): Promise<FridayData> {
  const client = (await listFridayClients(orgId)).find((c) => c.id === clientId);
  if (!client) throw new Error("Not a campaign client / client of this workspace");
  const w = fridayWindow(now);

  const compIds = (await getCompetitorIds(orgId, clientId)).filter((id) => id !== clientId);
  const comps = compIds.length
    ? await rawDb.client.findMany({ where: { id: { in: compIds }, organizationId: orgId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  const roles = new Map<string, { name: string; role: Role }>([[client.id, { name: client.name, role: "self" }]]);
  for (const c of comps) roles.set(c.id, { name: c.name, role: "competitor" });
  const ids = Array.from(roles.keys());

  const [rows, last] = await Promise.all([
    rawDb.socialPost.findMany({
      where: { clientId: { in: ids }, publishedDateLocal: { gte: w.prevFrom, lte: w.weekTo } },
      select: {
        id: true, clientId: true, platform: true, publishedDateLocal: true, postTextSnippet: true, postTextFull: true,
        hashtags: true, hasMedia: true, likeCount: true, commentCount: true, shareCount: true, postUrl: true,
      },
      orderBy: { publishedAtUtc: "desc" },
      take: 4000,
    }),
    rawDb.socialPost.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _max: { publishedDateLocal: true } }),
  ]);
  const lastOf = new Map(last.map((l) => [l.clientId, l._max.publishedDateLocal || null]));

  const posts: FPost[] = rows.map((r) => {
    const who = roles.get(r.clientId)!;
    return {
      id: r.id,
      companyId: r.clientId,
      company: who.name,
      role: who.role,
      platform: String(r.platform),
      date: r.publishedDateLocal,
      text: (r.postTextFull || r.postTextSnippet || "").replace(/\s+/g, " ").trim().slice(0, 1200),
      hashtagsCol: r.hashtags,
      hasMedia: r.hasMedia,
      likes: r.likeCount,
      comments: r.commentCount,
      shares: r.shareCount,
      url: r.postUrl,
    };
  });

  const self = statsFor({ id: client.id, name: client.name, role: "self" }, posts, w, lastOf.get(client.id) || null);
  const competitors = comps
    .map((c) => statsFor({ id: c.id, name: c.name, role: "competitor" }, posts, w, lastOf.get(c.id) || null))
    .sort((a, b) => b.engagementWeek - a.engagementWeek || b.postsWeek - a.postsWeek);
  const weekPosts = posts
    .filter((p) => p.date >= w.weekFrom && p.date <= w.weekTo)
    .sort((a, b) => b.likes + b.comments * 2 + b.shares * 3 - (a.likes + a.comments * 2 + a.shares * 3));

  return {
    orgId,
    dayKey: etDayKey(0, now),
    window: w,
    weekLabel: weekLabelOf(w),
    client,
    self,
    competitors,
    comparison: compare(self, competitors),
    weekPosts,
  };
}
