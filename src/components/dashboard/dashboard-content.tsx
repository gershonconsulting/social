import prisma from "@/lib/db";
import { ClientStatus } from "@prisma/client";
import { DashboardClient } from "./dashboard-client";

async function getDashboardData() {
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
    };
  });
}

export async function DashboardContent() {
  const clients = await getDashboardData();
  const totalPosts = clients.reduce((sum, c) => sum + c.totalPosts, 0);
  const totalFollowers = clients.reduce((sum, c) => sum + c.totalFollowers, 0);
  const activeClients = clients.length;

  return <DashboardClient clients={clients} totalPosts={totalPosts} totalFollowers={totalFollowers} activeClients={activeClients} />;
}
