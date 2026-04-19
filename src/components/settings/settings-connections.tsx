"use client";
import { useState } from "react";
import { ExternalLink, Plug, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";

interface ConnectionInfo {
  id: string;
  platform: string;
  externalAccountName: string | null;
  tokenExpiresAt: string | null;
  connectionStatus: string;
  client: { id: string; name: string };
}

const PLATFORMS = [
  {
    key: "LINKEDIN",
    name: "LinkedIn",
    icon: "🔗",
    color: "blue",
    description: "Connect your LinkedIn account to fetch company page posts, engagement metrics, and follower data for all your managed clients.",
    scopes: "Organization admin, social reading, follower counts",
  },
  {
    key: "TWITTER",
    name: "X / Twitter",
    icon: "𝕏",
    color: "gray",
    description: "Connect your X/Twitter account to monitor client tweets, mentions, and engagement.",
    scopes: "Tweet read, user read",
  },
  {
    key: "GOOGLE_BUSINESS",
    name: "Google Business Profile",
    icon: "📍",
    color: "green",
    description: "Connect your Google account to track Business Profile posts and reviews for your clients.",
    scopes: "Business Profile management",
  },
];

export function SettingsConnections({
  connections,
  linkedinConfigured,
  appUrl,
}: {
  connections: Record<string, ConnectionInfo[]>;
  linkedinConfigured: boolean;
  appUrl: string;
}) {
  const [connecting, setConnecting] = useState<string | null>(null);

  const handleConnect = (platform: string) => {
    if (platform === "LINKEDIN" && linkedinConfigured) {
      setConnecting(platform);
      // For LinkedIn, we need a clientId and connectionId.
      // The connect flow will prompt to select which client to connect.
      window.location.href = `/settings/connect?platform=${platform}`;
    } else {
      alert(`${platform} OAuth integration coming soon. Please configure the API credentials first.`);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Platform Connections</h2>
        <p className="text-xs text-gray-500 mt-1">
          Connect your social media admin accounts to enable post syncing and analytics for all clients
        </p>
      </div>
      <div className="divide-y divide-gray-50">
        {PLATFORMS.map((platform) => {
          const conns = connections[platform.key] || [];
          const hasConnected = conns.length > 0;
          const allExpired = conns.length > 0 && conns.every(
            (c) => c.tokenExpiresAt && new Date(c.tokenExpiresAt) < new Date()
          );

          return (
            <div key={platform.key} className="px-6 py-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="text-2xl mt-0.5">{platform.icon}</div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{platform.name}</div>
                    <p className="text-xs text-gray-500 mt-0.5 max-w-md">
                      {platform.description}
                    </p>
                    <div className="text-[10px] text-gray-400 mt-1">
                      Scopes: {platform.scopes}
                    </div>

                    {/* Show connected clients */}
                    {conns.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {conns.map((conn) => {
                          const expired = conn.tokenExpiresAt && new Date(conn.tokenExpiresAt) < new Date();
                          return (
                            <div key={conn.id} className="flex items-center gap-2 text-xs">
                              {expired ? (
                                <AlertCircle size={12} className="text-amber-500" />
                              ) : (
                                <CheckCircle size={12} className="text-green-500" />
                              )}
                              <span className="text-gray-600">
                                {conn.client.name}
                                {conn.externalAccountName && ` — ${conn.externalAccountName}`}
                              </span>
                              {expired && (
                                <span className="text-amber-600 font-medium">Token expired</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0">
                  {hasConnected && !allExpired ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                        <CheckCircle size={12} /> Connected
                      </span>
                      <button
                        onClick={() => handleConnect(platform.key)}
                        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg"
                      >
                        <RefreshCw size={11} />
                        Reconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnect(platform.key)}
                      disabled={connecting === platform.key}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      <Plug size={12} />
                      {connecting === platform.key ? "Connecting…" : allExpired ? "Reconnect" : "Connect"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
