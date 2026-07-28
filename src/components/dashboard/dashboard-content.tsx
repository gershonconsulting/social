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
  const clients = await prisma.client.findMany({
    where: { status: ClientStatus.ACTIVE },
    include: {
      platformConnections: {
        where: { isEnabled: true },
        select: {
          id: true,
          platform: true,
          connectionStatus: true,
          lastSyncAt: true,
        },
      },
      socialPosts: {
        select: {
          platform: true,
          publishedDateLocal: true,
          likeCount: true,
          commentCount: true,
          shareCount: true,
          viewCount: true,
        },
      },
      followerSnapshots: {
        orderBy: { snapshotDateLocal: "desc" },
        take: 50,
        select: {
          platform: true,
          followerCount: true,
          snapshotDateLocal: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lastMonth = now.getMonth() === 0
    ? `${now.getFullYear() - 1}-12`
    : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;

  // Window boundaries — used so the dashboard can re-aggregate by Last week,
  // Last Month, This month, This year, All time without each company card
  // having to re-filter the raw post stream.
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(today);
  lastWeekStart.setDate(today.getDate() - 7);
  const thisYearStr = String(now.getFullYear());

  return clients.map((client) => {
    const postCounts: Record<string, number> = {};
    const buckets = {
      lastWeek:   { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 },
      lastMonth:  { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 },
      thisMonth:  { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 },
      thisYear:   { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 },
      allTime:    { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 },
    };
    for (const post of client.socialPosts) {
      postCounts[post.platform] = (postCounts[post.platform] || 0) + 1;
      const ds = post.publishedDateLocal;
      const d = new Date(ds + "T00:00:00Z");
      const likes = post.likeCount || 0;
      const comments = post.commentCount || 0;
      const shares = post.shareCount || 0;
      const views = post.viewCount || 0;

      const bump = (b: typeof buckets.lastWeek) => {
        b.posts++; b.likes += likes; b.comments += comments; b.shares += shares; b.views += views;
      };
      bump(buckets.allTime);
      if (ds.startsWith(thisYearStr)) bump(buckets.thisYear);
      if (ds.startsWith(thisMonth)) bump(buckets.thisMonth);
      if (ds.startsWith(lastMonth)) bump(buckets.lastMonth);
      if (d >= lastWeekStart && d <= today) bump(buckets.lastWeek);
    }
    // Posting cadence — for the "is this company posting regularly?" view
    // 1. lastPostDateLocal: most recent post across all platforms (or null if never)
    // 2. posts30d: number of posts in the last 30 days
    let lastPostDateLocal: string | null = null;
    const today30 = new Date(now);
    today30.setHours(0, 0, 0, 0);
    const window30Start = new Date(today30);
    window30Start.setDate(today30.getDate() - 30);
    let posts30d = 0;
    for (const post of client.socialPosts) {
      if (!lastPostDateLocal || post.publishedDateLocal > lastPostDateLocal) {
        lastPostDateLocal = post.publishedDateLocal;
      }
      const d = new Date(post.publishedDateLocal + "T00:00:00Z");
      if (d >= window30Start && d <= today30) posts30d++;
    }
    const totalPosts = buckets.allTime.posts;
    const postsThisMonth = buckets.thisMonth.posts;
    const postsLastMonth = buckets.lastMonth.posts;
    const totalLikes = buckets.allTime.likes;
    const totalComments = buckets.allTime.comments;
    const totalShares = buckets.allTime.shares;
    const totalViews = buckets.allTime.views;

    // Compute follower totals and growth
    const latestFollowers: Record<string, number> = {};
    const previousFollowers: Record<string, number> = {};
    // Snapshots are ordered desc — first snap per platform is latest, second is previous.
    // Use 'in' instead of falsy check so a legit 0-follower snapshot isn't ignored.
    for (const snap of client.followerSnapshots) {
      if (!(snap.platform in latestFollowers)) {
        latestFollowers[snap.platform] = snap.followerCount;
      } else if (!(snap.platform in previousFollowers)) {
        previousFollowers[snap.platform] = snap.followerCount;
      }
    }
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
      platformConnections: client.platformConnections.map((c) => ({
        id: c.id,
        platform: c.platform as string,
        connectionStatus: c.connectionStatus as string,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      })),
      postCounts,
      totalPosts,
      postsThisMonth,
      postsLastMonth,
      totalFollowers,
      followerGrowth,
      platformFollowers,
      totalLikes,
      totalComments,
      totalShares,
      totalViews,
      buckets,
      lastPostDateLocal,
      posts30d,
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
