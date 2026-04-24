export const runtime = 'edge';
import { Suspense } from "react";
import prisma from "@/lib/db";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConnectionBadge } from "@/components/ui/connection-badge";
import { formatDate, formatRelative } from "@/lib/utils";
import { ClientStatus } from "@prisma/client";
import Link from "next/link";
import { Plus, Filter } from "lucide-react";

export const dynamic = "force-dynamic";

const CLIENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  INCOMPLETE_SETUP: "Incomplete Setup",
  ARCHIVED: "Archived",
};

async function getClients() {
  return prisma.client.findMany({
    where: { status: { not: ClientStatus.ARCHIVED } },
    include: {
      platformConnections: {
        where: { isEnabled: true },
        select: {
          platform: true,
          connectionStatus: true,
          lastSyncAt: true,
          isMandatory: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export default async function ClientsPage() {
  const clients = await getClients();

  return (
    <div>
      <Header
        title="Companies"
        subtitle={`${clients.filter((c) => c.status === "ACTIVE").length} active · ${clients.length} total`}
        actions={
          <Link
            href="/admin?tab=clients&action=new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#FE1B04] rounded-lg hover:bg-[#d11200] transition-colors"
          >
            <Plus size={15} />
            Add Company
          </Link>
        }
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 font-medium text-gray-500">Company</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Platforms</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Campaign Start</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Last Sync</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clients.map((client) => {
                const errorConns = client.platformConnections.filter(
                  (c) => c.connectionStatus === "ERROR" || c.connectionStatus === "EXPIRED"
                );
                const lastSync = client.platformConnections
                  .map((c) => c.lastSyncAt)
                  .filter(Boolean)
                  .sort()
                  .reverse()[0];

                return (
                  <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <Link
                        href={`/clients/${client.id}`}
                        className="font-medium text-gray-900 hover:text-red-600"
                      >
                        {client.name}
                      </Link>
                      <div className="text-xs text-gray-400 mt-0.5">{client.slug}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          client.status === "ACTIVE"
                            ? "bg-green-50 text-green-700"
                            : client.status === "PAUSED"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-gray-50 text-gray-500"
                        }`}
                      >
                        {CLIENT_STATUS_LABELS[client.status] ?? client.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-1">
                        {client.platformConnections.map((conn) => (
                          <ConnectionBadge key={conn.platform} status={conn.connectionStatus} />
                        ))}
                        {client.platformConnections.length === 0 && (
                          <span className="text-xs text-gray-400">No platforms</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-500">
                      {formatDate(client.campaignStartDate)}
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-500">
                      {formatRelative(lastSync?.toISOString())}
                    </td>
                    <td className="px-4 py-4">
                      {errorConns.length > 0 ? (
                        <span className="text-xs text-red-600 font-medium">
                          {errorConns.length} error{errorConns.length !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
