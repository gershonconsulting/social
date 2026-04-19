import prisma from "@/lib/db";
import { ClientStatus, ClientType } from "@prisma/client";
import { Header } from "@/components/layout/header";
import { formatRelative } from "@/lib/utils";
import Link from "next/link";
import {
  Users,
  Building2,
  Handshake,
  Target,
  Home,
  Activity,
} from "lucide-react";

const GROUP_CONFIG = [
  { type: ClientType.CLIENT, label: "Clients", icon: "users", color: "blue" },
  { type: ClientType.PARTNER, label: "Partners", icon: "handshake", color: "purple" },
  { type: ClientType.PROSPECT, label: "Prospects", icon: "target", color: "amber" },
  { type: ClientType.INTERNAL, label: "Internal", icon: "home", color: "green" },
] as const;

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
          externalAccountUrl: true,
        },
      },
      _count: {
        select: { socialPosts: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // Get post counts per platform per client
  const postsByClient = await prisma.socialPost.groupBy({
    by: ["clientId", "platform"],
    _count: { id: true },
  });

  const postMap: Record<string, Record<string, number>> = {};
  for (const row of postsByClient) {
    if (!postMap[row.clientId]) postMap[row.clientId] = {};
    postMap[row.clientId][row.platform] = row._count.id;
  }

  return { clients, postMap };
}

export async function DashboardContent() {
  const { clients, postMap } = await getDashboardData();

  const grouped = GROUP_CONFIG.map((g) => ({
    ...g,
    clients: clients.filter((c) => c.clientType === g.type),
  }));

  const totalPosts = Object.values(postMap).reduce(
    (sum, platforms) => sum + Object.values(platforms).reduce((s, c) => s + c, 0),
    0
  );

  return (
    <div>
      <Header
        title="Dashboard"
        subtitle={`Social media overview · ${clients.length} companies · ${totalPosts} posts collected`}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {grouped.map((g) => {
          const bgMap = { blue: "bg-blue-50", purple: "bg-purple-50", amber: "bg-amber-50", green: "bg-green-50" };
          const textMap = { blue: "text-blue-600", purple: "text-purple-600", amber: "text-amber-600", green: "text-green-600" };
          const IconMap = { users: Users, handshake: Handshake, target: Target, home: Home };
          const Icon = IconMap[g.icon];
          return (
            <div key={g.type} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className={`inline-flex p-2 rounded-lg ${bgMap[g.color]} mb-3`}>
                <Icon size={18} className={textMap[g.color]} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{g.clients.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">{g.label}</div>
            </div>
          );
        })}
      </div>

      {/* Grouped sections */}
      {grouped.map((g) => {
        if (g.clients.length === 0) return null;
        const borderMap = { blue: "border-blue-200", purple: "border-purple-200", amber: "border-amber-200", green: "border-green-200" };
        const headerBgMap = { blue: "bg-blue-50", purple: "bg-purple-50", amber: "bg-amber-50", green: "bg-green-50" };
        const headerTextMap = { blue: "text-blue-800", purple: "text-purple-800", amber: "text-amber-800", green: "text-green-800" };

        return (
          <div key={g.type} className={`bg-white rounded-xl border ${borderMap[g.color]} overflow-hidden mb-6`}>
            <div className={`px-6 py-3 ${headerBgMap[g.color]} border-b ${borderMap[g.color]}`}>
              <h2 className={`text-sm font-semibold ${headerTextMap[g.color]}`}>
                {g.label} ({g.clients.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Company</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Total Posts</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">LinkedIn</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">X / Twitter</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Google</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Connections</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">Last Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {g.clients.map((client) => {
                    const posts = postMap[client.id] || {};
                    const totalClientPosts = Object.values(posts).reduce((s, c) => s + c, 0);
                    const connCount = client.platformConnections.length;
                    const activeConns = client.platformConnections.filter(
                      (c) => c.connectionStatus === "CONNECTED" || c.connectionStatus === "PENDING"
                    ).length;
                    const lastSync = client.platformConnections
                      .map((c) => c.lastSyncAt)
                      .filter(Boolean)
                      .sort()
                      .pop();

                    return (
                      <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <Link
                            href={`/clients/${client.id}`}
                            className="font-medium text-gray-900 hover:text-blue-600 inline-flex items-center gap-2"
                          >
                            <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 border border-gray-200">
                              {client.name.charAt(0).toUpperCase()}
                            </span>
                            {client.name}
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-center">
                          {totalClientPosts > 0 ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
                              <Activity size={14} className="text-indigo-500" />
                              {totalClientPosts}
                            </span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {posts["LINKEDIN"] ? (
                            <span className="text-sm font-medium text-gray-700">{posts["LINKEDIN"]}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {posts["TWITTER"] ? (
                            <span className="text-sm font-medium text-gray-700">{posts["TWITTER"]}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {posts["GOOGLE_BUSINESS"] ? (
                            <span className="text-sm font-medium text-gray-700">{posts["GOOGLE_BUSINESS"]}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className={`text-xs font-medium ${activeConns === connCount && connCount > 0 ? "text-green-600" : "text-gray-400"}`}>
                            {activeConns}/{connCount}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-xs text-gray-400">
                            {lastSync ? formatRelative(lastSync.toISOString()) : "Never"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
