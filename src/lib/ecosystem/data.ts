/**
 * Ecosystem data — v4.65.0. Feeds Social's own Dashboard and Summary.
 *
 * Social (social.gershon.ai) is the client-intelligence platform: "who is
 * posting what" across the whole business world — company, clients,
 * partners, competitors, prospects, internal, campaign. Campaign objectives,
 * compliance and content stock moved to Social Tracking (socialtracking.
 * gershon.ai) and are deliberately NOT computed here.
 *
 * Edge budget (see project_social_outage_2026_08_21): everything is
 * aggregated in Postgres (GROUP BY / window functions). The worker never
 * loads raw posts — only per-company aggregates, a capped set of feed / top
 * posts and a capped hashtag list. Every raw query is constrained to the
 * company ids returned by the tenant-scoped client, so it can never read
 * another workspace's rows.
 *
 * The sidebar category / network filters are client-side state, so the
 * payload carries every category and the client component narrows it.
 */
import prisma from "@/lib/db";
import { ClientStatus } from "@prisma/client";
import { ecoWindows, nyDay, addDays, type EcoWindow } from "./windows";

// ── Collection status ────────────────────────────────────────────────────
// A connection is stale if it has not been checked within 48h: the collector
// runs at least daily, so that leaves one missed run of slack.
const STALE_MS = 48 * 60 * 60 * 1000;

export type CollectionState = "collected" | "empty" | "failed" | "stale" | "never";

export interface ConnStatus {
  clientId: string;
  clientName: string;
  platform: string;
  state: CollectionState;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface CollectionStatus {
  lastUpdate: string | null;
  totalConfigured: number;
  counts: Record<CollectionState, number>;
  connections: ConnStatus[];
}

export async function getCollectionStatus(): Promise<CollectionStatus> {
  const now = Date.now();
  const recentWindow = new Date(now - STALE_MS);

  const [conns, clients, collectedGroups] = await Promise.all([
    prisma.platformConnection.findMany({
      where: { isEnabled: true, externalAccountUrl: { not: null }, client: { status: ClientStatus.ACTIVE } },
      select: { id: true, clientId: true, platform: true, connectionStatus: true, lastSyncAt: true, lastSyncError: true },
    }),
    prisma.client.findMany({ where: { status: ClientStatus.ACTIVE }, select: { id: true, name: true } }),
    // Connections that had at least one post written/refreshed in the window.
    prisma.socialPost.groupBy({
      by: ["platformConnectionId"],
      where: { updatedAt: { gte: recentWindow } },
      _count: { _all: true },
    }),
  ]);

  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  const collected = new Set(collectedGroups.filter((g) => (g._count._all ?? 0) > 0).map((g) => g.platformConnectionId));
  const counts: Record<CollectionState, number> = { collected: 0, empty: 0, failed: 0, stale: 0, never: 0 };
  let lastUpdate: number | null = null;

  const connections: ConnStatus[] = conns.map((c) => {
    const synced = c.lastSyncAt ? c.lastSyncAt.getTime() : null;
    if (synced !== null && (lastUpdate === null || synced > lastUpdate)) lastUpdate = synced;
    const failed = c.connectionStatus === "ERROR" || !!c.lastSyncError;
    let state: CollectionState;
    if (synced === null) state = "never";
    else if (now - synced > STALE_MS) state = "stale";
    else if (failed) state = "failed";
    else if (collected.has(c.id)) state = "collected";
    else state = "empty";
    counts[state] += 1;
    return {
      clientId: c.clientId,
      clientName: nameById.get(c.clientId) ?? c.clientId,
      platform: c.platform as string,
      state,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      lastSyncError: c.lastSyncError ?? null,
    };
  });

  return {
    lastUpdate: lastUpdate !== null ? new Date(lastUpdate).toISOString() : null,
    totalConfigured: conns.length,
    counts,
    connections,
  };
}

// ── Payload ──────────────────────────────────────────────────────────────

export const NETS = ["LINKEDIN", "TWITTER"] as const;

export interface EcoCompany {
  id: string;
  name: string;
  logoUrl: string | null;
  type: string;
  /** Networks with an enabled connection that has an account URL. */
  networks: string[];
  /** Last publication date seen for this company (any network), YYYY-MM-DD. */
  lastPost: string | null;
  /** Per network, never summed across networks or companies. */
  followers: Array<{ platform: string; now: number; at: string; then: number | null }>;
}

/** [companyIdx, networkIdx (0 LinkedIn, 1 X), windowIdx, posts, prevPosts, engagement, prevEngagement] */
export type AggRow = [number, number, number, number, number, number, number];

/** [companyIdx, networkIdx, state, lastSyncAt | null, error | null] */
export type ConnRow = [number, number, CollectionState, string | null, string | null];

export interface EcoPost {
  c: number;
  n: number; // network idx
  d: string; // publication date YYYY-MM-DD
  url: string | null;
  t: string;
  l: number;
  cm: number;
  s: number;
  v: number;
}

/** [windowIdx, category, tag, count this period, count previous period] */
export type TagRow = [number, string, string, number, number];

export interface EcoData {
  today: string;
  windows: EcoWindow[];
  companies: EcoCompany[];
  agg: AggRow[];
  conns: ConnRow[];
  lastUpdate: string | null;
  /** Dashboard only. */
  posts?: EcoPost[];
  /** Per window: indexes into `posts` — latest first. */
  latest?: number[][];
  /** Per window: indexes into `posts` — most engagement first. */
  top?: number[][];
  /** null = hashtag data unavailable (query failed), [] = none found. */
  tags?: TagRow[] | null;
}

const NET_IDX: Record<string, number> = { LINKEDIN: 0, TWITTER: 1 };

export async function getEcosystemData(opts: { withPosts?: boolean } = {}): Promise<EcoData> {
  const today = nyDay();
  const windows = ecoWindows(today);
  const wi = windows.map((_, i) => i);
  // Sent as text[] (the Neon adapter path proven in production), cast in SQL.
  const wis = wi.map(String);
  const cf = windows.map((w) => w.from);
  const ct = windows.map((w) => w.to);
  // No previous period → an empty range that can never match.
  const pf = windows.map((w) => w.prevFrom ?? "9999-12-31");
  const pt = windows.map((w) => w.prevTo ?? "0000-01-01");
  const f30 = addDays(today, -30);

  const clients = await prisma.client.findMany({
    where: { status: ClientStatus.ACTIVE },
    select: { id: true, name: true, logoUrl: true, clientType: true },
    orderBy: { name: "asc" },
  });
  const ids = clients.map((c) => c.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  if (ids.length === 0) {
    return { today, windows, companies: [], agg: [], conns: [], lastUpdate: null, posts: [], latest: wi.map(() => []), top: wi.map(() => []), tags: [] };
  }

  type Agg = { wi: number; clientId: string; platform: string; n: number; pn: number; e: number; pe: number };
  type Last = { clientId: string; d: string | null };
  type Fol = { clientId: string; platform: string; n: number; d: string };
  type Conn = { clientId: string; platform: string };
  type PostRow = {
    id: string; clientId: string; platform: string; d: string; url: string | null; t: string | null;
    l: number; cm: number; s: number; v: number; wi: number; rl: number; re: number;
  };
  type Tag = { wi: number; ty: string; tag: string; n: number; pn: number };

  const [agg, last, folNow, folThen, conns, collection, postRows, tagRows] = await Promise.all([
    prisma.$queryRaw<Agg[]>`
      SELECT w.si::int AS wi, sp."clientId", sp.platform::text AS platform,
             COUNT(*) FILTER (WHERE sp."publishedDateLocal" BETWEEN w.cf AND w.ct)::int AS n,
             COUNT(*) FILTER (WHERE sp."publishedDateLocal" BETWEEN w.pf AND w.pt)::int AS pn,
             COALESCE(SUM(sp."likeCount" + sp."commentCount" + sp."shareCount")
                      FILTER (WHERE sp."publishedDateLocal" BETWEEN w.cf AND w.ct), 0)::int AS e,
             COALESCE(SUM(sp."likeCount" + sp."commentCount" + sp."shareCount")
                      FILTER (WHERE sp."publishedDateLocal" BETWEEN w.pf AND w.pt), 0)::int AS pe
      FROM social_posts sp
      JOIN unnest(${wis}::text[], ${cf}::text[], ${ct}::text[], ${pf}::text[], ${pt}::text[]) AS w(si, cf, ct, pf, pt)
        ON sp."publishedDateLocal" BETWEEN w.cf AND w.ct OR sp."publishedDateLocal" BETWEEN w.pf AND w.pt
      WHERE sp."clientId" = ANY(${ids}) AND sp.platform::text IN ('LINKEDIN','TWITTER')
      GROUP BY 1,2,3`,
    prisma.$queryRaw<Last[]>`
      SELECT "clientId", MAX("publishedDateLocal") AS d FROM social_posts
      WHERE "clientId" = ANY(${ids}) GROUP BY 1`,
    prisma.$queryRaw<Fol[]>`
      SELECT DISTINCT ON ("clientId", platform) "clientId", platform::text AS platform, "followerCount" AS n, "snapshotDateLocal" AS d
      FROM follower_snapshots WHERE "clientId" = ANY(${ids})
      ORDER BY "clientId", platform, "snapshotDateLocal" DESC`,
    prisma.$queryRaw<Fol[]>`
      SELECT DISTINCT ON ("clientId", platform) "clientId", platform::text AS platform, "followerCount" AS n, "snapshotDateLocal" AS d
      FROM follower_snapshots WHERE "clientId" = ANY(${ids}) AND "snapshotDateLocal" <= ${f30}
      ORDER BY "clientId", platform, "snapshotDateLocal" DESC`,
    prisma.platformConnection.findMany({
      where: { clientId: { in: ids }, isEnabled: true, externalAccountUrl: { not: null } },
      select: { clientId: true, platform: true },
    }) as Promise<Conn[]>,
    getCollectionStatus(),
    // Feed + top posts: per (window, category, network) the 8 latest and the
    // 4 most engaged. Capped in SQL; posts shared by several windows are sent once.
    opts.withPosts
      ? prisma.$queryRaw<PostRow[]>`
          SELECT * FROM (
            SELECT sp.id, sp."clientId", sp.platform::text AS platform, sp."publishedDateLocal" AS d,
                   sp."postUrl" AS url, LEFT(COALESCE(sp."postTextSnippet", sp."postTextFull", ''), 220) AS t,
                   sp."likeCount" AS l, sp."commentCount" AS cm, sp."shareCount" AS s, sp."viewCount" AS v,
                   w.si::int AS wi,
                   ROW_NUMBER() OVER (PARTITION BY w.si, c."clientType", sp.platform
                                      ORDER BY sp."publishedDateLocal" DESC, sp."publishedAtUtc" DESC)::int AS rl,
                   ROW_NUMBER() OVER (PARTITION BY w.si, c."clientType", sp.platform
                                      ORDER BY (sp."likeCount" + sp."commentCount" + sp."shareCount") DESC,
                                               sp."publishedDateLocal" DESC)::int AS re
            FROM social_posts sp
            JOIN clients c ON c.id = sp."clientId"
            JOIN unnest(${wis}::text[], ${cf}::text[], ${ct}::text[]) AS w(si, cf, ct)
              ON sp."publishedDateLocal" BETWEEN w.cf AND w.ct
            WHERE sp."clientId" = ANY(${ids}) AND sp.platform::text IN ('LINKEDIN','TWITTER')
          ) x
          WHERE rl <= 8 OR (re <= 4 AND (l + cm + s) > 0)`
      : Promise.resolve([] as PostRow[]),
    // Hashtags: #tags in the text plus the stored hashtags column, counted
    // once per post, current vs previous period, top 12 per (window, category).
    opts.withPosts
      ? prisma.$queryRaw<Tag[]>`
          WITH p AS (
            SELECT sp.id, c."clientType"::text AS ty, sp."publishedDateLocal" AS d,
                   lower(COALESCE(sp."postTextFull", sp."postTextSnippet", '')) AS t,
                   lower(COALESCE(sp.hashtags, '')) AS h
            FROM social_posts sp JOIN clients c ON c.id = sp."clientId"
            WHERE sp."clientId" = ANY(${ids})
          ), tags AS (
            SELECT p.id, p.ty, p.d, m[1] AS tag FROM p CROSS JOIN LATERAL regexp_matches(p.t, '#([a-z][a-z0-9_]{1,40})', 'g') AS m
            UNION
            SELECT p.id, p.ty, p.d, m[1] AS tag FROM p CROSS JOIN LATERAL regexp_matches(p.h, '([a-z][a-z0-9_]{1,40})', 'g') AS m
          ), agg AS (
            SELECT w.si::int AS wi, tags.ty, tags.tag,
                   COUNT(DISTINCT tags.id) FILTER (WHERE tags.d BETWEEN w.cf AND w.ct)::int AS n,
                   COUNT(DISTINCT tags.id) FILTER (WHERE tags.d BETWEEN w.pf AND w.pt)::int AS pn
            FROM tags
            JOIN unnest(${wis}::text[], ${cf}::text[], ${ct}::text[], ${pf}::text[], ${pt}::text[]) AS w(si, cf, ct, pf, pt)
              ON tags.d BETWEEN w.cf AND w.ct OR tags.d BETWEEN w.pf AND w.pt
            GROUP BY 1,2,3
          )
          SELECT wi, ty, tag, n, pn FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY wi, ty ORDER BY n DESC, tag) AS rn FROM agg WHERE n > 0
          ) x WHERE rn <= 12`.catch(() => null)
      : Promise.resolve([] as Tag[]),
  ]);

  const lastM = new Map(last.map((r) => [r.clientId, r.d]));
  const thenM = new Map(folThen.map((f) => [`${f.clientId}|${f.platform}`, f.n]));

  const companies: EcoCompany[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    logoUrl: c.logoUrl,
    type: c.clientType as string,
    networks: Array.from(
      new Set(conns.filter((x) => x.clientId === c.id && (x.platform as string) in NET_IDX).map((x) => x.platform as string)),
    ),
    lastPost: lastM.get(c.id) ?? null,
    followers: folNow
      .filter((f) => f.clientId === c.id && f.platform in NET_IDX)
      .map((f) => ({ platform: f.platform, now: f.n, at: f.d, then: thenM.get(`${c.id}|${f.platform}`) ?? null })),
  }));

  const data: EcoData = {
    today,
    windows,
    companies,
    agg: agg
      .filter((a) => idx.has(a.clientId))
      .map((a) => [idx.get(a.clientId)!, NET_IDX[a.platform], a.wi, a.n, a.pn, a.e, a.pe]),
    conns: collection.connections
      .filter((x) => idx.has(x.clientId) && x.platform in NET_IDX)
      .map((x) => [idx.get(x.clientId)!, NET_IDX[x.platform], x.state, x.lastSyncAt, x.lastSyncError ? x.lastSyncError.slice(0, 120) : null]),
    lastUpdate: collection.lastUpdate,
  };

  if (opts.withPosts) {
    const posts: EcoPost[] = [];
    const pos = new Map<string, number>();
    const latest: number[][] = wi.map(() => []);
    const top: number[][] = wi.map(() => []);
    for (const r of postRows) {
      if (!idx.has(r.clientId)) continue;
      let p = pos.get(r.id);
      if (p === undefined) {
        p = posts.length;
        pos.set(r.id, p);
        posts.push({
          c: idx.get(r.clientId)!, n: NET_IDX[r.platform], d: r.d, url: r.url, t: r.t ?? "",
          l: r.l, cm: r.cm, s: r.s, v: r.v,
        });
      }
      if (r.rl <= 8) latest[r.wi].push(p);
      if (r.re <= 4 && r.l + r.cm + r.s > 0) top[r.wi].push(p);
    }
    for (const list of latest) list.sort((a, b) => (posts[b].d > posts[a].d ? 1 : posts[b].d < posts[a].d ? -1 : 0));
    const eng = (p: EcoPost) => p.l + p.cm + p.s;
    for (const list of top) list.sort((a, b) => eng(posts[b]) - eng(posts[a]));
    data.posts = posts;
    data.latest = latest;
    data.top = top;
    data.tags = tagRows ? tagRows.map((t) => [t.wi, t.ty, t.tag, t.n, t.pn]) : null;
  }

  return data;
}
