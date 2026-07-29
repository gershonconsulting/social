import prisma from "@/lib/db";
import { ClientStatus } from "@prisma/client";
import { DashboardClient } from "./dashboard-client";
import type {
  CollectionStatus,
  CollectionState,
  ConnStatus,
} from "./collection-status-panel";

// A connection is considered "stale" if it has not been scraped within this
// window. The local Watchman scraper runs at least daily, so 48h gives one
// missed run of slack before we flag it.
const STALE_MS = 48 * 60 * 60 * 1000;

export async function getCollectionStatus(): Promise<CollectionStatus> {
  const now = Date.now();
  const recentWindow = new Date(now - STALE_MS);

  const [conns, clients, collectedGroups] = await Promise.all([
    prisma.platformConnection.findMany({
      where: {
        isEnabled: true,
        externalAccountUrl: { not: null },
        client: { status: ClientStatus.ACTIVE },
      },
      select: {
        id: true,
        clientId: true,
        platform: true,
        connectionStatus: true,
        lastSyncAt: true,
        lastSyncError: true,
      },
    }),
    prisma.client.findMany({
      where: { status: ClientStatus.ACTIVE },
      select: { id: true, name: true },
    }),
    // Connections that had at least one post written/refreshed in the window —
    // i.e. the last run actually pulled content for them.
    prisma.socialPost.groupBy({
      by: ["platformConnectionId"],
      where: { updatedAt: { gte: recentWindow } },
      _count: { _all: true },
    }),
  ]);

  const nameById = new Map(clients.map((c) => [c.id, c.name]));
  const collectedConnIds = new Set(
    collectedGroups
      .filter((g) => (g._count._all ?? 0) > 0)
      .map((g) => g.platformConnectionId)
  );

  const counts = { collected: 0, empty: 0, failed: 0, stale: 0 };
  let lastUpdate: number | null = null;

  const connections: ConnStatus[] = conns.map((c) => {
    const synced = c.lastSyncAt ? c.lastSyncAt.getTime() : null;
    if (synced !== null && (lastUpdate === null || synced > lastUpdate)) {
      lastUpdate = synced;
    }
    const recentlySynced = synced !== null && now - synced <= STALE_MS;
    const failed = c.connectionStatus === "ERROR" || !!c.lastSyncError;

    let state: CollectionState;
    if (!recentlySynced) state = "stale";
    else if (failed) state = "failed";
    else if (collectedConnIds.has(c.id)) state = "collected";
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

  // Surface the problems first: failed, then stale, then empty, then collected.
  const severity: Record<CollectionState, number> = { failed: 0, stale: 1, empty: 2, collected: 3 };
  connections.sort(
    (a, b) => severity[a.state] - severity[b.state] || a.clientName.localeCompare(b.clientName)
  );

  return {
    lastUpdate: lastUpdate !== null ? new Date(lastUpdate).toISOString() : null,
    totalConfigured: conns.length,
    counts,
    connections,
  };
}

export async function getDashboardData() {
  // IMPORTANT (Cloudflare edge — error 1102 "Worker exceeded resource limits"):
  // this used to load EVERY post for EVERY company into the worker and sum in JS,
  // which blew the CPU limit as the dataset grew and made /summary and /dashboard
  // fail to render. We now aggregate in the database (groupBy) so each query
  // returns one row per company instead of thousands of posts.
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth(); // 0-based
  const pad = (n: number) => String(n).padStart(2, "0");
  const thisMonthStart = `${y}-${pad(mo + 1)}-01`;
  const nextMonthStart = mo === 11 ? `${y + 1}-01-01` : `${y}-${pad(mo + 2)}-01`;
  const lastMonthStart = mo === 0 ? `${y - 1}-12-01` : `${y}-${pad(mo)}-01`;
  const thisYearStart = `${y}-01-01`;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const lw = new Date(today); lw.setDate(today.getDate() - 7);
  const lastWeekStart = lw.toISOString().slice(0, 10);
  const w30 = new Date(today); w30.setDate(today.getDate() - 30);
  const win30Start = w30.toISOString().slice(0, 10);
  const fw = new Date(today); fw.setDate(today.getDate() - 21);
  const followerSince = fw.toISOString().slice(0, 10);

  const clients = await prisma.client.findMany({
    where: { status: ClientStatus.ACTIVE },
    select: { id: true, name: true, logoUrl: true, clientType: true },
    orderBy: { name: "asc" },
  });
  if (clients.length === 0) return [];
  const ids = clients.map((c) => c.id);

  const sumWindow = (extra: Record<string, unknown>) =>
    prisma.socialPost.groupBy({
      by: ["clientId"],
      where: { clientId: { in: ids }, ...extra },
      _count: { _all: true },
      _sum: { likeCount: true, commentCount: true, shareCount: true, viewCount: true },
    });

  const [allTimeA, thisMonthA, lastMonthA, thisYearA, lastWeekA, platA, lastPostA, posts30A, conns, snaps] =
    await Promise.all([
      sumWindow({}),
      sumWindow({ publishedDateLocal: { gte: thisMonthStart, lt: nextMonthStart } }),
      sumWindow({ publishedDateLocal: { gte: lastMonthStart, lt: thisMonthStart } }),
      sumWindow({ publishedDateLocal: { gte: thisYearStart } }),
      sumWindow({ publishedDateLocal: { gte: lastWeekStart, lte: todayStr } }),
      prisma.socialPost.groupBy({ by: ["clientId", "platform"], where: { clientId: { in: ids } }, _count: { _all: true } }),
      prisma.socialPost.groupBy({ by: ["clientId"], where: { clientId: { in: ids } }, _max: { publishedDateLocal: true } }),
      prisma.socialPost.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, publishedDateLocal: { gte: win30Start, lte: todayStr } }, _count: { _all: true } }),
      prisma.platformConnection.findMany({ where: { clientId: { in: ids }, isEnabled: true }, select: { clientId: true, id: true, platform: true, connectionStatus: true, lastSyncAt: true } }),
      prisma.followerSnapshot.findMany({ where: { clientId: { in: ids }, snapshotDateLocal: { gte: followerSince } }, orderBy: { snapshotDateLocal: "desc" }, select: { clientId: true, platform: true, followerCount: true } }),
    ]);

  type Bucket = { posts: number; likes: number; comments: number; shares: number; views: number };
  const emptyBucket = (): Bucket => ({ posts: 0, likes: 0, comments: 0, shares: 0, views: 0 });
  const bucketMap = (rows: typeof allTimeA) => {
    const mp = new Map<string, Bucket>();
    for (const r of rows) {
      mp.set(r.clientId, {
        posts: r._count._all,
        likes: r._sum.likeCount ?? 0,
        comments: r._sum.commentCount ?? 0,
        shares: r._sum.shareCount ?? 0,
        views: r._sum.viewCount ?? 0,
      });
    }
    return mp;
  };
  const allTimeM = bucketMap(allTimeA);
  const thisMonthM = bucketMap(thisMonthA);
  const lastMonthM = bucketMap(lastMonthA);
  const thisYearM = bucketMap(thisYearA);
  const lastWeekM = bucketMap(lastWeekA);

  const postCountsM = new Map<string, Record<string, number>>();
  for (const r of platA) {
    const rec = postCountsM.get(r.clientId) ?? {};
    rec[r.platform as string] = r._count._all;
    postCountsM.set(r.clientId, rec);
  }
  const lastPostM = new Map<string, string | null>();
  for (const r of lastPostA) lastPostM.set(r.clientId, r._max.publishedDateLocal ?? null);
  const posts30M = new Map<string, number>();
  for (const r of posts30A) posts30M.set(r.clientId, r._count._all);

  const connM = new Map<string, Array<{ id: string; platform: string; connectionStatus: string; lastSyncAt: string | null }>>();
  for (const c of conns) {
    const arr = connM.get(c.clientId) ?? [];
    arr.push({ id: c.id, platform: c.platform as string, connectionStatus: c.connectionStatus as string, lastSyncAt: c.lastSyncAt?.toISOString() ?? null });
    connM.set(c.clientId, arr);
  }

  // Followers — snaps come ordered desc, so first per (client, platform) is the
  // latest and the second is the previous. Use 'in' so a legit 0 isn't skipped.
  const latestM = new Map<string, Record<string, number>>();
  const prevM = new Map<string, Record<string, number>>();
  for (const s of snaps) {
    const latest = latestM.get(s.clientId) ?? {}; latestM.set(s.clientId, latest);
    const prev = prevM.get(s.clientId) ?? {}; prevM.set(s.clientId, prev);
    const p = s.platform as string;
    if (!(p in latest)) latest[p] = s.followerCount;
    else if (!(p in prev)) prev[p] = s.followerCount;
  }

  return clients.map((client) => {
    const buckets = {
      lastWeek: lastWeekM.get(client.id) ?? emptyBucket(),
      lastMonth: lastMonthM.get(client.id) ?? emptyBucket(),
      thisMonth: thisMonthM.get(client.id) ?? emptyBucket(),
      thisYear: thisYearM.get(client.id) ?? emptyBucket(),
      allTime: allTimeM.get(client.id) ?? emptyBucket(),
    };
    const latestFollowers = latestM.get(client.id) ?? {};
    const previousFollowers = prevM.get(client.id) ?? {};
    const totalFollowers = Object.values(latestFollowers).reduce((s, c) => s + c, 0);
    const totalPrevFollowers = Object.values(previousFollowers).reduce((s, c) => s + c, 0);
    const followerGrowth = totalPrevFollowers > 0
      ? Math.round(((totalFollowers - totalPrevFollowers) / totalPrevFollowers) * 100)
      : 0;
    const platformFollowers: Array<{ platform: string; current: number; previous: number; growth: number }> = [];
    for (const [plat, current] of Object.entries(latestFollowers)) {
      const prev = previousFollowers[plat] || 0;
      const growth = prev > 0 ? Math.round(((current - prev) / prev) * 100) : 0;
      platformFollowers.push({ platform: plat, current, previous: prev, growth });
    }

    return {
      id: client.id,
      name: client.name,
      logoUrl: client.logoUrl,
      clientType: client.clientType as string,
      platformConnections: connM.get(client.id) ?? [],
      postCounts: postCountsM.get(client.id) ?? {},
      totalPosts: buckets.allTime.posts,
      postsThisMonth: buckets.thisMonth.posts,
      postsLastMonth: buckets.lastMonth.posts,
      totalFollowers,
      followerGrowth,
      platformFollowers,
      totalLikes: buckets.allTime.likes,
      totalComments: buckets.allTime.comments,
      totalShares: buckets.allTime.shares,
      totalViews: buckets.allTime.views,
      buckets,
      lastPostDateLocal: lastPostM.get(client.id) ?? null,
      posts30d: posts30M.get(client.id) ?? 0,
    };
  });
}

export async function DashboardContent({
  heading = "Dashboard",
  subheading = "Social media performance overview",
}: {
  heading?: string;
  subheading?: string;
} = {}) {
  const [clients, collectionStatus] = await Promise.all([
    getDashboardData(),
    getCollectionStatus(),
  ]);
  const totalPosts = clients.reduce((sum, c) => sum + c.totalPosts, 0);
  const totalFollowers = clients.reduce((sum, c) => sum + c.totalFollowers, 0);
  const activeClients = clients.length;

  return (
    <DashboardClient
      clients={clients}
      totalPosts={totalPosts}
      totalFollowers={totalFollowers}
      activeClients={activeClients}
      collectionStatus={collectionStatus}
      heading={heading}
      subheading={subheading}
    />
  );
}
