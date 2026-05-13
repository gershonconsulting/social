export const runtime = 'edge';
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import { Header } from "@/components/layout/header";
import { formatDate, formatRelative } from "@/lib/utils";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { Calendar } from "lucide-react";
import { ClientSyncButton } from "@/components/clients/client-sync-button";
import { ClientNameEditor } from "@/components/clients/client-name-editor";
import { ClientCategoryEditor } from "@/components/clients/client-category-editor";
import { ComplianceDashboard } from "@/components/clients/compliance-dashboard";
import { PostsListing } from "@/components/clients/posts-listing";
import { CampaignDateEditor } from "@/components/clients/campaign-date-editor";
import { CompanyLogo } from "@/components/clients/company-logo";

export const dynamic = "force-dynamic";

const PLATFORM_LABELS_MAP: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  TIKTOK: "TikTok",
  THREADS: "Threads",
  PINTEREST: "Pinterest",
  MEDIUM: "Medium",
  REDDIT: "Reddit",
  BLOG_RSS: "Blog / RSS" };

async function getClientData(id: string) {
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      platformConnections: {
        include: {
          followerSnapshots: {
            orderBy: { snapshotDateLocal: "desc" },
            take: 2 } },
        orderBy: { platform: "asc" } } } });

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
              {client.timezone} · <CampaignDateEditor clientId={client.id} initialDate={client.campaignStartDate ? client.campaignStartDate.toISOString() : null} />
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastSync && (
              <div className="text-xs text-gray-400">
                Last sync {formatRelative(lastSync.toISOString())}
              </div>
            )}
            <ClientSyncButton clientId={client.id} />
          </div>
        </div>
      </div>


      {/* Posting Compliance — THE BIG NUMBER */}
      <ComplianceDashboard clientId={client.id} platforms={allPlatforms} />

      {/* Recent Posts */}
                  <PostsListing clientId={client.id} />

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
