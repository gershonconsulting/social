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

      <ApplyTokensToPendingButton onDone={() => setAttempt((a) => a + 1)} />

      <TestAllConnectionsButton
        connectionIds={Object.values(connections).flat().map((c) => c.id)}
        onDone={() => setAttempt((a) => a + 1)}
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

function TestAllConnectionsButton({
  connectionIds,
  onDone,
}: {
  connectionIds: string[];
  onDone: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; status?: string; error?: string }>>({});

  async function runAll() {
    if (connectionIds.length === 0) return;
    setRunning(true);
    setResults({});
    const next: typeof results = {};
    for (const id of connectionIds) {
      try {
        const r = await fetch(`/api/platforms/${id}/test`, { method: "POST" });
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          next[id] = { ok: false, error: `Non-JSON HTTP ${r.status}` };
          continue;
        }
        const j = await r.json();
        next[id] = {
          ok: !!j.success,
          status: j?.data?.status,
          error: j?.data?.error || j?.error,
        };
      } catch (e) {
        next[id] = { ok: false, error: e instanceof Error ? e.message : "Network error" };
      }
      // Update incrementally so the user sees progress
      setResults({ ...next });
    }
    setRunning(false);
    onDone();
  }

  const passed = Object.values(results).filter((r) => r.ok).length;
  const failed = Object.values(results).filter((r) => !r.ok).length;
  const totalRun = Object.keys(results).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-gray-900">Verify connections</div>
        <div className="text-xs text-gray-500 mt-0.5">
          Probes every platform connection above with its stored token. Updates the badge to
          CONNECTED / EXPIRED / ERROR / PENDING based on what the API actually returns.
        </div>
        {totalRun > 0 && (
          <div className="text-xs mt-1.5">
            <span className="text-green-700 font-medium">{passed} ok</span>
            {" · "}
            <span className="text-red-700 font-medium">{failed} failing</span>
            {totalRun < connectionIds.length && (
              <> · <span className="text-gray-500">{totalRun}/{connectionIds.length} tested</span></>
            )}
          </div>
        )}
      </div>
      <button
        onClick={runAll}
        disabled={running || connectionIds.length === 0}
        className="px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-2 whitespace-nowrap"
      >
        {running ? "Testing…" : `Test all (${connectionIds.length})`}
      </button>
    </div>
  );
}

function ApplyTokensToPendingButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ totalApplied: number; results: Array<{ platform: string; appliedTo: number; skipped: string | null }> } | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setResult(null);
    setError("");
    try {
      const r = await fetch("/api/settings/propagate-tokens", { method: "POST" });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setError(`Non-JSON HTTP ${r.status}`);
      } else {
        const j = await r.json();
        if (j.success) {
          setResult(j.data);
          onDone();
        } else {
          setError(j.error || "Failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-gray-900">Apply existing tokens to PENDING connections</div>
        <div className="text-xs text-gray-500 mt-0.5">
          Companies created after a platform was authorized may have PENDING connections
          even though you have a valid token. This copies your token onto every PENDING
          row of the same platform so they flip to CONNECTED. Safe to run repeatedly.
        </div>
        {result && (
          <div className="text-xs mt-1.5 text-green-700">
            Applied to {result.totalApplied} connection{result.totalApplied !== 1 ? "s" : ""}.
            {result.results.filter((r) => r.appliedTo > 0).map((r) => ` ${r.platform}: ${r.appliedTo}`).join(" ·")}
          </div>
        )}
        {error && <div className="text-xs mt-1.5 text-red-700">{error}</div>}
      </div>
      <button
        onClick={run}
        disabled={running}
        className="px-3 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-60 inline-flex items-center gap-2 whitespace-nowrap"
      >
        {running ? "Applying…" : "Apply to pending"}
      </button>
    </div>
  );
}

function RemoveYouTubeDataButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ connectionsRemoved: number } | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (!confirm("Remove EVERY YouTube platform connection and its posts / compliance / follower data?\n\nThis is irreversible. Use only if you are sure YouTube is no longer a tracked platform.")) {
      return;
    }
    setRunning(true);
    setResult(null);
    setError("");
    try {
      const r = await fetch("/api/admin/cleanup-platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "YOUTUBE" }),
      });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setError(`Non-JSON HTTP ${r.status}`);
      } else {
        const j = await r.json();
        if (j.success) {
          setResult(j.data);
          onDone();
        } else {
          setError(j.error || "Failed");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-gray-900">Remove YouTube data</div>
        <div className="text-xs text-gray-500 mt-0.5">
          YouTube is no longer a tracked platform. Click to permanently delete every YouTube
          platform connection + its posts, compliance, follower snapshots, and schedules.
        </div>
        {result && (
          <div className="text-xs mt-1.5 text-green-700">
            Removed {result.connectionsRemoved} YouTube connection{result.connectionsRemoved !== 1 ? "s" : ""}
            {" "}and all related data.
          </div>
        )}
        {error && <div className="text-xs mt-1.5 text-red-700">{error}</div>}
      </div>
      <button
        onClick={run}
        disabled={running}
        className="px-3 py-2 text-sm font-medium text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-60 inline-flex items-center gap-2 whitespace-nowrap"
      >
        {running ? "Removing…" : "Remove YouTube data"}
      </button>
    </div>
  );
}
