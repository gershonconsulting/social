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

  return clients.map((client) => {
    const postCounts: Record<string, number> = {};
    let postsThisMonth = 0;
    let postsLastMonth = 0;
    for (const post of client.socialPosts) {
      postCounts[post.platform] = (postCounts[post.platform] || 0) + 1;
      if (post.publishedDateLocal.startsWith(thisMonth)) postsThisMonth++;
      if (post.publishedDateLocal.startsWith(lastMonth)) postsLastMonth++;
    }
    const totalPosts = Object.values(postCounts).reduce((s, c) => s + c, 0);

    // Compute follower totals and growth
    const latestFollowers: Record<string, number> = {};
    const previousFollowers: Record<string, number> = {};
    for (const snap of client.followerSnapshots) {
      if (!latestFollowers[snap.platform]) {
        latestFollowers[snap.platform] = snap.followerCount;
      } else if (!previousFollowers[snap.platform]) {
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
