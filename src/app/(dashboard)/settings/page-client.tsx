"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { SettingsConnections } from "@/components/settings/settings-connections";

interface ConnRow {
  id: string;
  platform: string;
  externalAccountName: string | null;
  tokenExpiresAt: string | null;
  connectionStatus: string;
  hasToken: boolean;
  client: { id: string; name: string };
}

interface SettingsData {
  connections: Record<string, ConnRow[]>;
  config: {
    linkedinConfigured: boolean;
    linkedinSecretConfigured: boolean;
    googleConfigured: boolean;
    googleSecretConfigured: boolean;
    appUrl: string;
  };
}

export function SettingsPageClient() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      let lastErr = "";
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch("/api/settings/connections", { cache: "no-store" });
          if (!r.ok) {
            let body: { error?: string } | null = null;
            try { body = await r.json(); } catch {}
            lastErr = body?.error || `HTTP ${r.status}`;
          } else {
            const j = await r.json();
            if (!cancelled) {
              setData(j?.data ?? null);
              setLoading(false);
            }
            return;
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : "Network error";
        }
        await new Promise((res) => setTimeout(res, 250 * (i + 1)));
      }
      if (!cancelled) {
        setError(lastErr || "Could not load settings");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  if (loading) {
    return (
      <div className="space-y-8">
        <Header title="Settings" subtitle="Manage your platform connections and API credentials" />
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading settings…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-8">
        <Header title="Settings" subtitle="Manage your platform connections and API credentials" />
        <div className="mx-auto max-w-md mt-8 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto text-amber-600 mb-2" />
          <div className="text-sm font-semibold text-amber-900">
            Could not load settings
          </div>
          <div className="text-xs text-amber-800 mt-1">{error || "No data"}</div>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { connections, config } = data;

  return (
    <div className="space-y-8">
      <Header
        title="Settings"
        subtitle="Manage your platform connections and API credentials"
      />

      <SettingsConnections
        connections={connections}
        linkedinConfigured={config.linkedinConfigured}
        googleConfigured={config.googleConfigured}
        appUrl={config.appUrl}
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
          <ConfigRow
            name="LINKEDIN_CLIENT_ID"
            description="LinkedIn Developer App Client ID"
            ok={config.linkedinConfigured}
          />
          <ConfigRow
            name="LINKEDIN_CLIENT_SECRET"
            description="LinkedIn Developer App Client Secret"
            ok={config.linkedinSecretConfigured}
          />
          <ConfigRow
            name="GOOGLE_CLIENT_ID"
            description="Google OAuth Client ID for Business Profile"
            ok={config.googleConfigured}
          />
          <ConfigRow
            name="GOOGLE_CLIENT_SECRET"
            description="Google OAuth Client Secret"
            ok={config.googleSecretConfigured}
          />
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ name, description, ok }: { name: string; description: string; ok: boolean }) {
  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-gray-900">{name}</div>
          <div className="text-xs text-gray-400 mt-0.5">{description}</div>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full ${ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}
        >
          {ok ? "Configured" : "Not set"}
        </span>
      </div>
    </div>
  );
}
