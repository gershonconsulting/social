"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithRetry } from "@/lib/fetch-retry";
import Link from "next/link";
import { Calendar, AlertCircle, Loader2 } from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { ClientSyncButton } from "@/components/clients/client-sync-button";
import { ClientNameEditor } from "@/components/clients/client-name-editor";
import { ClientCategoryEditor } from "@/components/clients/client-category-editor";
import { ComplianceDashboard } from "@/components/clients/compliance-dashboard";
import { PostsListing } from "@/components/clients/posts-listing";
import { CampaignDateEditor } from "@/components/clients/campaign-date-editor";
import { ConnectionUrlEditor } from "@/components/clients/connection-url-editor";
import { PlatformIcon } from "@/components/ui/platform-icon";

const PLATFORM_LABELS_MAP: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  TIKTOK: "TikTok",
  THREADS: "Threads",
  PINTEREST: "Pinterest",
  MEDIUM: "Medium",
  REDDIT: "Reddit",
  BLOG_RSS: "Blog / RSS",
};

// Lightweight inline form to create a new PlatformConnection for this
// client. Used when the company has no row for LinkedIn / X / GMB yet
// — Olivier wanted to be able to add missing links from the company
// page rather than having to go to /admin.
function AddConnectionInline({ clientId, platform }: { clientId: string; platform: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("URL required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          platform,
          externalAccountUrl: trimmed,
        }),
      });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setError(`HTTP ${r.status}`);
      } else {
        const j = await r.json();
        if (j.success) {
          window.location.assign(window.location.pathname + window.location.search);
          return;
        }
        setError(j.error || "Save failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:underline"
      >
        + Add link
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="url"
        autoFocus
        placeholder={
          platform === "LINKEDIN" ? "https://www.linkedin.com/company/..." :
          platform === "TWITTER" ? "https://x.com/handle" :
          platform === "GOOGLE_BUSINESS" ? "Maps URL or business name" :
          "https://..."
        }
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setOpen(false); setError(""); } }}
        className="text-xs px-2 py-1 border border-gray-300 rounded w-72"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-xs px-2 py-1 bg-green-600 text-white rounded">
        {saving ? "…" : "Save"}
      </button>
      <button onClick={() => { setOpen(false); setUrl(""); setError(""); }} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700">
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}


interface Connection {
  id: string;
  platform: string;
  externalAccountName: string | null;
  externalAccountUrl: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  connectionStatus: string;
}

interface ClientData {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  clientType: string;
  campaignStartDate: string | null;
  platformConnections: Connection[];
}


export function ClientDetailPageClient({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithRetry("/api/clients/" + clientId);
        if (!r.ok) {
          if (r.status === 404) { router.replace("/clients"); return; }
          throw new Error("HTTP " + r.status);
        }
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "load failed");
        if (!cancelled) { setClient(j.data); setLoading(false); }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load this company");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 size={20} className="animate-spin mr-2" />
        Loading company…
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-2xl">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-red-900">Couldn&apos;t load this company</div>
            <div className="text-sm text-red-700 mt-1">{error || "Unknown error"}</div>
            <div className="text-xs text-red-600 mt-3">
              Cloudflare worker likely hit a resource limit. This is usually transient.
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setError(null); setLoading(true); setTimeout(() => { window.location.reload(); }, 100); }}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Retry
              </button>
              <Link
                href="/clients"
                className="px-3 py-1.5 text-sm font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50"
              >
                Back to Companies
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              <ClientCategoryEditor clientId={client.id} initialClientType={client.clientType as never} />
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {client.timezone} · <CampaignDateEditor clientId={client.id} initialDate={client.campaignStartDate} />
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastSync && (
              <div className="text-xs text-gray-400">
                Last sync {formatRelative(lastSync)}
              </div>
            )}
            <ClientSyncButton clientId={client.id} />
          </div>
        </div>
      </div>

      <ComplianceDashboard clientId={client.id} platforms={allPlatforms as never[]} />

      <PostsListing clientId={client.id} />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <div className="text-sm font-semibold text-gray-900">Platforms</div>
          <div className="text-xs text-gray-500 mt-0.5">Click any URL to edit. Updates take effect on the next sync.</div>
        </div>
        <div className="divide-y divide-gray-50">
          {client.platformConnections.length === 0 && (
            <div className="px-5 py-6 text-sm text-gray-400 text-center">No platforms attached to this company.</div>
          )}
          {client.platformConnections.map((conn) => (
            <div key={conn.id} className="px-5 py-3 flex items-center gap-3">
              <PlatformIcon platform={conn.platform as never} size={28} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {PLATFORM_LABELS_MAP[conn.platform] ?? conn.platform}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  <ConnectionUrlEditor
                    connectionId={conn.id}
                    platform={conn.platform as never}
                    initialUrl={conn.externalAccountUrl}
                    initialName={conn.externalAccountName}
                  />
                </div>
              </div>
            </div>
          ))}
          {/* Show an 'Add link' row for any of the 3 core platforms (LinkedIn / X / GMB)
              that doesn't already have a PlatformConnection row for this client. */}
          {(["LINKEDIN", "TWITTER", "GOOGLE_BUSINESS"] as const)
            .filter((p) => !client.platformConnections.some((c) => c.platform === p))
            .map((platform) => (
              <div key={"missing-" + platform} className="px-5 py-3 flex items-center gap-3 bg-gray-50/60">
                <PlatformIcon platform={platform as never} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-700">
                    {PLATFORM_LABELS_MAP[platform] ?? platform}
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">not configured</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    <AddConnectionInline clientId={client.id} platform={platform} />
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

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
