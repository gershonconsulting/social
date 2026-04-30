export const runtime = 'edge';
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConnectionBadge } from "@/components/ui/connection-badge";
import { formatDate, formatDateTime, formatRelative, freshnessFromLastSync } from "@/lib/utils";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { ExternalLink, Calendar, Plug } from "lucide-react";
import { ClientSyncButton } from "@/components/clients/client-sync-button";
import { ClientNameEditor } from "@/components/clients/client-name-editor";
import { ClientCategoryEditor } from "@/components/clients/client-category-editor";
import { ComplianceDashboard } from "@/components/clients/compliance-dashboard";
import { PostsListing } from "@/components/clients/posts-listing";
import { BeforeAfterPanel } from "@/components/clients/before-after-panel";
import { TestConnectionButton } from "@/components/clients/test-connection-button";
import { ConnectionUrlEditor } from "@/components/clients/connection-url-editor";
import { HashtagCloud } from "@/components/clients/hashtag-cloud";
import { WordCloud } from "@/components/clients/word-cloud";
import { CompanyLogo } from "@/components/clients/company-logo";

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

  return { client };
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getClientData(id);
  if (!data) notFound();

  const { client } = data;

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
            <div className="mt-2">
              <ClientCategoryEditor clientId={client.id} initialClientType={client.clientType} />
            </div>
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

      {/* Posting Compliance — THE BIG NUMBER */}
      <ComplianceDashboard clientId={client.id} platforms={allPlatforms} />

      {/* Before us · After us comparison around the campaign start date */}
      <BeforeAfterPanel clientId={client.id} />

      {/* Recent Posts */}
                  <PostsListing clientId={client.id} />

      {/* Content Intelligence */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <HashtagCloud clientId={client.id} />
                    <WordCloud clientId={client.id} />
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
                      <ConnectionUrlEditor
                        connectionId={conn.id}
                        platform={conn.platform}
                        initialUrl={conn.externalAccountUrl}
                        initialName={conn.externalAccountName}
                      />
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
                  <div className="flex flex-col items-end gap-1">
                    <ConnectionBadge status={conn.connectionStatus} />
                    <TestConnectionButton connectionId={conn.id} />
                    {(conn.connectionStatus === "EXPIRED" || conn.connectionStatus === "ERROR" || conn.connectionStatus === "PENDING" || conn.connectionStatus === "DISCONNECTED") && (
                      <Link
                        href="/settings"
                        className="text-xs text-red-600 hover:text-red-700 hover:underline font-medium"
                      >
                        Reconnect →
                      </Link>
                    )}
                    {conn.lastSyncError && (
                      <span className="text-[10px] text-red-500 max-w-[220px] text-right truncate" title={conn.lastSyncError}>
                        {conn.lastSyncError}
                      </span>
                    )}
                  </div>
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
