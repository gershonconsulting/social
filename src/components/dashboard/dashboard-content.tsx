import prisma from "@/lib/db";
import { ClientStatus, ComplianceStatus } from "@prisma/client";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConnectionBadge } from "@/components/ui/connection-badge";
import { formatRelative, freshnessFromLastSync } from "@/lib/utils";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import {
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  HelpCircle,
  RefreshCw,
} from "lucide-react";

async function getDashboardData() {
  const today = formatInTimeZone(new Date(), "America/New_York", "yyyy-MM-dd");

  const clients = await prisma.client.findMany({
    where: { status: ClientStatus.ACTIVE },
    include: {
      platformConnections: {
        where: { isEnabled: true },
        include: {
          dailyCompliance: {
            where: { dateLocal: today },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return { clients, today };
}

export async function DashboardContent() {
  const { clients, today } = await getDashboardData();

  let totalActive = 0;
  let missingToday = 0;
  let connectionErrors = 0;
  let fullyCompliant = 0;
  let totalPosts = 0;
  let totalUnknown = 0;

  const rows = clients.map((client) => {
    totalActive++;
    const todayLocal = formatInTimeZone(new Date(), client.timezone, "yyyy-MM-dd");
    const statuses: Record<string, string> = {};
    let hasMissing = false;
    let hasUnknown = false;
    let hasError = false;
    let connIssues = 0;
    let lastSyncAt: Date | null = null;

    for (const conn of client.platformConnections) {
      if (conn.connectionStatus === "ERROR" || conn.connectionStatus === "EXPIRED") {
        hasError = true;
        connIssues++;
      }
      if (conn.lastSyncAt && (!lastSyncAt || conn.lastSyncAt > lastSyncAt)) {
        lastSyncAt = conn.lastSyncAt;
      }

      const rec = conn.dailyCompliance.find((r) => r.dateLocal === todayLocal && r.expectedFlag);
      if (rec) {
        statuses[conn.platform] = rec.status;
        if (rec.status === ComplianceStatus.RED) hasMissing = true;
        if (rec.status === ComplianceStatus.YELLOW) hasUnknown = true;
        if (rec.status === ComplianceStatus.GREEN) totalPosts += rec.verifiedPostCount;
      }
    }

    if (hasMissing) missingToday++;
    if (hasError) connectionErrors++;
    if (!hasMissing && !hasUnknown && Object.values(statuses).some((s) => s === "GREEN")) {
      if (Object.values(statuses).every((s) => s === "GREEN")) fullyCompliant++;
    }
    if (hasUnknown) totalUnknown++;

    const overall = hasMissing
      ? "RED"
      : hasUnknown
        ? "YELLOW"
        : Object.values(statuses).length > 0 && Object.values(statuses).every((s) => s === "GREEN")
          ? "GREEN"
          : "GRAY";

    return { client, statuses, overall, connIssues, lastSyncAt };
  });

  const summaryCards = [
    {
      label: "Active Clients",
      value: totalActive,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Missing Posts Today",
      value: missingToday,
      icon: XCircle,
      color: missingToday > 0 ? "text-red-600" : "text-gray-400",
      bg: missingToday > 0 ? "bg-red-50" : "bg-gray-50",
    },
    {
      label: "Connection Errors",
      value: connectionErrors,
      icon: AlertTriangle,
      color: connectionErrors > 0 ? "text-amber-600" : "text-gray-400",
      bg: connectionErrors > 0 ? "bg-amber-50" : "bg-gray-50",
    },
    {
      label: "Fully Compliant",
      value: fullyCompliant,
      icon: CheckCircle2,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Posts Detected Today",
      value: totalPosts,
      icon: Activity,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
    {
      label: "Unknown Verifications",
      value: totalUnknown,
      icon: HelpCircle,
      color: totalUnknown > 0 ? "text-orange-600" : "text-gray-400",
      bg: totalUnknown > 0 ? "bg-orange-50" : "bg-gray-50",
    },
  ];

  return (
    <div>
      <Header
        title="Dashboard"
        subtitle={`Operational compliance overview · ${today}`}
        actions={
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} />
            Run Sync
          </Link>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`inline-flex p-2 rounded-lg ${card.bg} mb-3`}>
              <card.icon size={18} className={card.color} />
            </div>
            <div className="text-2xl font-bold text-gray-900">{card.value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Client table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Active Clients — Today's Status</h2>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400 text-sm">
            No active clients. <Link href="/admin" className="text-blue-600 hover:underline">Add a client</Link> to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Client</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">Overall</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">LinkedIn</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">X / Twitter</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">Google</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">Other</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-500">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(({ client, statuses, overall, connIssues, lastSyncAt }) => {
                  const corePlatforms = ["LINKEDIN", "TWITTER", "GOOGLE_BUSINESS"];
                  const optionalCount = Object.keys(statuses).filter(
                    (p) => !corePlatforms.includes(p)
                  ).length;
                  const optionalGreen = Object.entries(statuses)
                    .filter(([p]) => !corePlatforms.includes(p))
                    .filter(([, s]) => s === "GREEN").length;

                  return (
                    <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <Link
                          href={`/clients/${client.id}`}
                          className="font-medium text-gray-900 hover:text-blue-600"
                        >
                          {client.name}
                        </Link>
                        {connIssues > 0 && (
                          <span className="ml-2 text-xs text-amber-600 font-medium">
                            {connIssues} issue{connIssues !== 1 ? "s" : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <StatusBadge status={overall} />
                      </td>
                      <td className="px-4 py-4 text-center">
                        {statuses["LINKEDIN"] ? (
                          <StatusBadge status={statuses["LINKEDIN"]} compact />
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {statuses["TWITTER"] ? (
                          <StatusBadge status={statuses["TWITTER"]} compact />
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {statuses["GOOGLE_BUSINESS"] ? (
                          <StatusBadge status={statuses["GOOGLE_BUSINESS"]} compact />
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center text-xs text-gray-500">
                        {optionalCount > 0 ? `${optionalGreen}/${optionalCount}` : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-xs text-gray-400">
                          {formatRelative(lastSyncAt?.toISOString())}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
