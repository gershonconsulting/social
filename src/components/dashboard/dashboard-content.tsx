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
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return clients.map((client) => {
    const postCounts: Record<string, number> = {};
    for (const post of client.socialPosts) {
      postCounts[post.platform] = (postCounts[post.platform] || 0) + 1;
    }
    const totalPosts = Object.values(postCounts).reduce((s, c) => s + c, 0);

    return {
      id: client.id,
      name: client.name,
      clientType: client.clientType as string,
      platformConnections: client.platformConnections.map((c) => ({
        id: c.id,
        platform: c.platform as string,
        connectionStatus: c.connectionStatus as string,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      })),
      postCounts,
      totalPosts,
    };
  });
}

export async function DashboardContent() {
  const clients = await getDashboardData();
  const totalPosts = clients.reduce((sum, c) => sum + c.totalPosts, 0);

  return <DashboardClient clients={clients} totalPosts={totalPosts} />;
}
