export const runtime = 'edge';
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConnectionBadge } from "@/components/ui/connection-badge";
import { formatDate, formatDateTime, formatRelative, freshnessFromLastSync } from "@/lib/utils";
import { formatInTimeZone } from "date-fns-tz";
import { ComplianceStatus } from "@prisma/client";
import Link from "next/link";
import { ExternalLink, RefreshCw, Calendar, TrendingUp, Plug } from "lucide-react";
import { ClientSyncButton } from "@/components/clients/client-sync-button";
import { ClientNameEditor } from "@/components/clients/client-name-editor";
import { PostsTabs } from "@/components/clients/posts-tabs";

export const dynamic = "force-dynamic";

const PLATFORM_LABELS_MAP: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  THREADS: "Threads",
  PINTEREST: "Pinterest",
  MEDIUM: "Medium",
  REDDIT: "Reddit",
  BLOG_RSS: "Blog / RSS",
};

async function getClientData(id: string) {
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      platformConnections: {
        include: {
          postingSchedules: true,
          followerSnapshots: {
            orderBy: { snapshotDateLocal: "desc" },
            take: 31,
          },
        },
        orderBy: { platform: "asc" },
      },
    },
  });

  if (!client) return null;

  // Get last 30 days of compliance
  const today = formatInTimeZone(new Date(), client.timezone, "yyyy-MM-dd");
  const thirtyDaysAgo = formatInTimeZone(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    client.timezone,
    "yyyy-MM-dd"
  );

  const compliance = await prisma.dailyCompliance.findMany({
    where: {
      clientId: id,
      dateLocal: { gte: thirtyDaysAgo, lte: today },
      expectedFlag: true,
    },
    orderBy: [{ dateLocal: "desc" }, { platform: "asc" }],
  });

  // Recent posts
  const recentPosts = await prisma.socialPost.findMany({
    where: { clientId: id },
    orderBy: { publishedAtUtc: "desc" },
    take: 20,
  });

  return { client, compliance, recentPosts, today };
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getClientData(id);
  if (!data) notFound();

  const { client, compliance, recentPosts, today } = data;

  // Group compliance by date
  const byDate = new Map<string, typeof compliance>();
  for (const rec of compliance) {
    if (!byDate.has(rec.dateLocal)) byDate.set(rec.dateLocal, []);
    byDate.get(rec.dateLocal)!.push(rec);
  }
  const sortedDates = Array.from(byDate.keys()).sort().reverse();

  const mandatoryConns = client.platformConnections.filter((c) => c.isMandatory);
  const allPlatforms = client.platformConnections.map((c) => c.platform);
  const lastSync = client.platformConnections
    .map((c) => c.lastSyncAt)
    .filter(Boolean)
    .sort()
    .reverse()[0];

  const freshness = lastSync ? freshnessFromLastSync(lastSync.toISOString()) : null;

  return (
    <div className="space-y-8">
      {/* Header with editable name */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              <ClientNameEditor clientId={client.id} initialName={client.name} />
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {client.timezone} · Campaign started {formatDate(client.campaignStartDate)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {freshness && (
              <div className="text-xs text-gray-400">
                {freshness.label}
                {lastSync && <span> · Last sync {formatRelative(lastSync.toISOString())}</span>}
              </div>
            )}
            <ClientSyncButton clientId={client.id} />
          </div>
        </div>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Status</div>
          <div className="font-semibold text-gray-900">{client.status}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Timezone</div>
          <div className="font-semibold text-gray-900">{client.timezone}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Owner</div>
          <div className="font-semibold text-gray-900">{client.internalOwner ?? "—"}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">Reporting Start</div>
          <div className="font-semibold text-gray-900">{formatDate(client.reportingStartDate)}</div>
        </div>
      </div>

      {/* Platform connections */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Platform Connections</h2>
          <div className="flex items-center gap-3">
            <Link
              href={`/settings`}
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <Plug size={11} />
              Connect accounts
            </Link>
            <Link
              href={`/admin?tab=platforms&clientId=${client.id}`}
              className="text-xs text-gray-500 hover:underline"
            >
              Manage
            </Link>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {client.platformConnections.map((conn) => {
            const snap = conn.followerSnapshots[0];
            const prevSnap = conn.followerSnapshots[1];
            const diff = snap && prevSnap ? snap.followerCount - prevSnap.followerCount : null;

            return (
              <div key={conn.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {PLATFORM_LABELS_MAP[conn.platform] ?? conn.platform}
                      {conn.isMandatory && (
                        <span className="ml-1.5 text-xs text-gray-400">(required)</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {conn.externalAccountUrl ? (
                        <a
                          href={conn.externalAccountUrl.startsWith("http") ? conn.externalAccountUrl : `https://${conn.externalAccountUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        >
                          <ExternalLink size={10} />
                          {conn.externalAccountName ?? conn.externalAccountUrl.replace(/^https?:\/\/(?:www\.)?/, "")}
                        </a>
                      ) : (
                        <span>{conn.externalAccountName ?? "Not configured"}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {snap && (
                    <div className="text-right">
                      <div className="text-sm font-medium text-gray-900">
                        {snap.followerCount.toLocaleString()} followers
                      </div>
                      {diff !== null && (
                        <div
                          className={`text-xs ${diff >= 0 ? "text-green-600" : "text-red-600"}`}
                        >
                          {diff >= 0 ? "+" : ""}
                          {diff} vs yesterday
                        </div>
                      )}
                    </div>
                  )}
                  <ConnectionBadge status={conn.connectionStatus} />
                </div>
              </div>
            );
          })}
          {client.platformConnections.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-400">
              No platforms configured.{" "}
              <Link href={`/admin?tab=platforms&clientId=${client.id}`} className="text-blue-600 hover:underline">
                Add a platform
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Posts views (Listing + Calendar tabs) */}
      <PostsTabs clientId={client.id} platforms={allPlatforms} />

      {/* Daily compliance matrix — last 30 days */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Daily Compliance — Last 30 Days</h2>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Verified</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Missing</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> Unknown</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-2.5 font-medium text-gray-500">Date</th>
                {mandatoryConns.map((conn) => (
                  <th key={conn.platform} className="text-center px-3 py-2.5 font-medium text-gray-500">
                    {PLATFORM_LABELS_MAP[conn.platform] ?? conn.platform}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedDates.slice(0, 30).map((date) => {
                const recs = byDate.get(date) ?? [];
                return (
                  <tr key={date} className={`hover:bg-gray-50 ${date === today ? "bg-blue-50/50" : ""}`}>
                    <td className="px-6 py-2.5 font-mono text-gray-600">
                      {date}
                      {date === today && (
                        <span className="ml-2 text-xs text-blue-600 font-medium">Today</span>
                      )}
                    </td>
                    {mandatoryConns.map((conn) => {
                      const rec = recs.find((r) => r.platform === conn.platform);
                      if (!rec) {
                        return (
                          <td key={conn.platform} className="px-3 py-2.5 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        );
                      }
                      return (
                        <td key={conn.platform} className="px-3 py-2.5 text-center">
                          {rec.primaryPostUrl ? (
                            <a
                              href={rec.primaryPostUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`View post · ${rec.verifiedPostCount} post(s)`}
                            >
                              <StatusBadge status={rec.status} compact />
                            </a>
                          ) : (
                            <StatusBadge status={rec.status} compact />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {sortedDates.length === 0 && (
                <tr>
                  <td colSpan={mandatoryConns.length + 1} className="px-6 py-8 text-center text-gray-400">
                    No compliance data yet. Run a sync or backfill to populate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly report link */}
      <div className="flex items-center justify-between bg-blue-50 rounded-xl border border-blue-200 px-6 py-4">
        <div>
          <div className="text-sm font-semibold text-blue-900">Monthly Compliance Reports</div>
          <div className="text-xs text-blue-700 mt-0.5">
            View and export monthly posting objective results
          </div>
        </div>
        <Link
          href={`/reports?clientId=${client.id}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
        >
          <Calendar size={14} />
          View Reports
        </Link>
      </div>
    </div>
  );
}
