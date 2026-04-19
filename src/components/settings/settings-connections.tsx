"use client";
import { useState, useEffect } from "react";
import { Plug, CheckCircle, AlertCircle, RefreshCw, Eye, EyeOff, Save, Loader2 } from "lucide-react";

interface ConnectionInfo {
  id: string;
  platform: string;
  externalAccountName: string | null;
  tokenExpiresAt: string | null;
  connectionStatus: string;
  hasToken: boolean;
  client: { id: string; name: string };
}

const PLATFORMS = [
  {
    key: "LINKEDIN",
    name: "LinkedIn",
    icon: "\ud83d\udd17",
    color: "blue",
    description: "Connect your LinkedIn account to fetch company page posts, engagement metrics, and follower data.",
    connectMethod: "oauth" as const,
  },
  {
    key: "TWITTER",
    name: "X / Twitter",
    icon: "\ud835\udd4f",
    color: "gray",
    description: "Enter your X/Twitter credentials to monitor tweets, mentions, and engagement.",
    connectMethod: "credentials" as const,
  },
  {
    key: "GOOGLE_BUSINESS",
    name: "Google Business Profile",
    icon: "\ud83d\udccd",
    color: "green",
    description: "Connect your Google account to track Business Profile posts and reviews.",
    connectMethod: "google-oauth" as const,
  },
];

function TwitterCredentialsForm({ onSaved }: { onSaved: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Both username and password are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch("/api/settings/twitter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ error: "Failed to save" }));
        throw new Error(data.error || "Failed to save credentials");
      }
      setSuccess(true);
      setPassword("");
      onSaved();
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 max-w-sm">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Username / Email</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="@youraccount"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-9"
            placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-green-600">Credentials saved successfully!</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
        {saving ? "Saving..." : "Save Credentials"}
      </button>
    </div>
  );
}

function SuccessBanner({ platform }: { platform: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-center gap-2">
      <CheckCircle size={16} className="text-green-600" />
      {platform} connected successfully!
    </div>
  );
}

export function SettingsConnections({
  connections,
  linkedinConfigured,
  googleConfigured,
  appUrl,
}: {
  connections: Record<string, ConnectionInfo[]>;
  linkedinConfigured: boolean;
  googleConfigured: boolean;
  appUrl: string;
}) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [showTwitterForm, setShowTwitterForm] = useState(false);
  const [successPlatform, setSuccessPlatform] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "google") setSuccessPlatform("Google Business Profile");
    if (params.get("success") === "linkedin") setSuccessPlatform("LinkedIn");
  }, []);

  const handleConnect = (platform: typeof PLATFORMS[number]) => {
    if (platform.connectMethod === "oauth" && platform.key === "LINKEDIN") {
      if (!linkedinConfigured) {
        alert("LinkedIn API credentials not configured yet. Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in Cloudflare Pages environment variables.");
        return;
      }
      setConnecting(platform.key);
      window.location.href = `/settings/connect?platform=${platform.key}`;
    } else if (platform.connectMethod === "credentials" && platform.key === "TWITTER") {
      setShowTwitterForm(true);
    } else if (platform.connectMethod === "google-oauth" && platform.key === "GOOGLE_BUSINESS") {
      if (!googleConfigured) {
        alert("Google API credentials not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare Pages environment variables.");
        return;
      }
      setConnecting(platform.key);
      window.location.href = `/api/auth/google/connect`;
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Platform Connections</h2>
        <p className="text-xs text-gray-500 mt-1">
          Connect your social media accounts to enable post syncing and analytics
        </p>
      </div>

      {successPlatform && (
        <div className="px-6 pt-4">
          <SuccessBanner platform={successPlatform} />
        </div>
      )}

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
                      {platform.connectMethod === "credentials"
                        ? "Connection: Username & Password"
                        : platform.connectMethod === "google-oauth"
                        ? "Connection: Google Account (Gmail)"
                        : "Connection: OAuth 2.0"}
                    </div>

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
                                {conn.externalAccountName && ` \u2014 ${conn.externalAccountName}`}
                              </span>
                              {expired && (
                                <span className="text-amber-600 font-medium">Token expired</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {platform.key === "TWITTER" && (showTwitterForm || (!hasConnected)) && (
                      <TwitterCredentialsForm
                        onSaved={() => {
                          setShowTwitterForm(false);
                          window.location.reload();
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0">
                  {platform.key === "TWITTER" ? (
                    hasConnected ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <CheckCircle size={12} /> Connected
                        </span>
                        <button
                          onClick={() => setShowTwitterForm(true)}
                          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg"
                        >
                          <RefreshCw size={11} />
                          Update
                        </button>
                      </div>
                    ) : null
                  ) : hasConnected && !allExpired ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                        <CheckCircle size={12} /> Connected
                      </span>
                      <button
                        onClick={() => handleConnect(platform)}
                        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 border border-gray-200 rounded-lg"
                      >
                        <RefreshCw size={11} />
                        Reconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnect(platform)}
                      disabled={connecting === platform.key}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      <Plug size={12} />
                      {connecting === platform.key ? "Connecting\u2026" : allExpired ? "Reconnect" : "Connect"}
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
