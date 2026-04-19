export const runtime = 'edge';
import prisma from "@/lib/db";
import { Header } from "@/components/layout/header";
import { SettingsConnections } from "@/components/settings/settings-connections";

export const dynamic = "force-dynamic";

async function getConnectionStatus() {
  const connections = await prisma.platformConnection.findMany({
    where: {
      platform: { in: ["LINKEDIN", "TWITTER", "GOOGLE_BUSINESS"] },
      connectionStatus: "CONNECTED",
    },
    select: {
      id: true,
      platform: true,
      externalAccountName: true,
      tokenExpiresAt: true,
      connectionStatus: true,
      tokenReference: true,
      client: { select: { id: true, name: true } },
    },
  });

  const byPlatform: Record<string, Array<{
    id: string;
    platform: string;
    externalAccountName: string | null;
    tokenExpiresAt: string | null;
    connectionStatus: string;
    hasToken: boolean;
    client: { id: string; name: string };
  }>> = {};
  for (const conn of connections) {
    const p = conn.platform;
    if (!byPlatform[p]) byPlatform[p] = [];
    byPlatform[p].push({
      id: conn.id,
      platform: conn.platform,
      externalAccountName: conn.externalAccountName,
      tokenExpiresAt: conn.tokenExpiresAt ? conn.tokenExpiresAt.toISOString() : null,
      connectionStatus: conn.connectionStatus,
      hasToken: !!conn.tokenReference,
      client: conn.client,
    });
  }
  return byPlatform;
}

export default async function SettingsPage() {
  const connections = await getConnectionStatus();

  const linkedinConfigured = !!process.env.LINKEDIN_CLIENT_ID;
  const googleConfigured = !!process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";

  return (
    <div className="space-y-8">
      <Header
        title="Settings"
        subtitle="Manage your platform connections and API credentials"
      />

      <SettingsConnections
        connections={connections}
        linkedinConfigured={linkedinConfigured}
        googleConfigured={googleConfigured}
        appUrl={appUrl}
      />

      {/* API Keys section */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">API Configuration</h2>
          <p className="text-xs text-gray-500 mt-1">
            Set these environment variables in your Cloudflare Pages dashboard
          </p>
        </div>
        <div className="divide-y divide-gray-50">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">LINKEDIN_CLIENT_ID</div>
                <div className="text-xs text-gray-400 mt-0.5">LinkedIn Developer App Client ID</div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${linkedinConfigured ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {linkedinConfigured ? "Configured" : "Not set"}
              </span>
            </div>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">LINKEDIN_CLIENT_SECRET</div>
                <div className="text-xs text-gray-400 mt-0.5">LinkedIn Developer App Client Secret</div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${process.env.LINKEDIN_CLIENT_SECRET ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {process.env.LINKEDIN_CLIENT_SECRET ? "Configured" : "Not set"}
              </span>
            </div>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">GOOGLE_CLIENT_ID</div>
                <div className="text-xs text-gray-400 mt-0.5">Google OAuth Client ID for Business Profile</div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${googleConfigured ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {googleConfigured ? "Configured" : "Not set"}
              </span>
            </div>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">GOOGLE_CLIENT_SECRET</div>
                <div className="text-xs text-gray-400 mt-0.5">Google OAuth Client Secret</div>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${process.env.GOOGLE_CLIENT_SECRET ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {process.env.GOOGLE_CLIENT_SECRET ? "Configured" : "Not set"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
