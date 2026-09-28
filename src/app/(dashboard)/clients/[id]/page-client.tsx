"use client";

/**
 * Company page — v4.14.0, manager view.
 *
 * Top to bottom: the verdict for this company and what to do about it, three
 * plain numbers, then the content itself. The posting calendar and the page
 * links / settings are folded away under "Details" so the first screen only
 * answers "is this company doing what it should".
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithRetry } from "@/lib/fetch-retry";
import Link from "next/link";
import { AlertCircle, Loader2, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight, Calendar } from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { ClientSyncButton } from "@/components/clients/client-sync-button";
import { ClientNameEditor } from "@/components/clients/client-name-editor";
import { ClientCategoryEditor } from "@/components/clients/client-category-editor";
import { ComplianceDashboard } from "@/components/clients/compliance-dashboard";
import { ClientContentTabs } from "@/components/clients/client-content-tabs";
import { CampaignDateEditor } from "@/components/clients/campaign-date-editor";
import { ConnectionUrlEditor } from "@/components/clients/connection-url-editor";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { COLLECTED_NETWORKS, NEXT_STEP, VERDICT_META, daysSinceDate, judge, lastPostLabel } from "@/lib/verdict";

const PLATFORM_LABELS_MAP: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
};

// Lightweight inline form to create a new PlatformConnection for this
// client, so a missing LinkedIn / X link can be added from the company page.
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
    // Retry on 5xx — CF worker cold-starts occasionally throw 1101/1102
    // even on a perfectly valid POST. Hide those from the user.
    let lastErr = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const r = await fetch("/api/platforms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, platform, externalAccountUrl: trimmed }),
        });
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          if (r.status >= 500 && attempt < 5) {
            lastErr = `transient HTTP ${r.status}`;
            await new Promise((res) => setTimeout(res, 250 * attempt));
            continue;
          }
          lastErr = `HTTP ${r.status}`;
          break;
        }
        const j = await r.json();
        if (j.success) {
          window.location.assign(window.location.pathname + window.location.search);
          return;
        }
        lastErr = j.error || "Save failed";
        if (r.status < 500) break;
        await new Promise((res) => setTimeout(res, 250 * attempt));
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "Network error";
        if (attempt < 5) await new Promise((res) => setTimeout(res, 250 * attempt));
      }
    }
    setError(lastErr || "Save failed");
    setSaving(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-red-700 hover:underline">
        + Add link
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input
        type="url"
        autoFocus
        placeholder={platform === "LINKEDIN" ? "https://www.linkedin.com/company/..." : "https://x.com/handle"}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setOpen(false);
            setError("");
          }
        }}
        className="text-xs h-8 px-2 border border-gray-300 rounded-md w-72"
        disabled={saving}
      />
      <button onClick={save} disabled={saving} className="text-xs h-8 px-3 bg-gray-900 text-white rounded-md">
        {saving ? "…" : "Save"}
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setUrl("");
          setError("");
        }}
        className="text-xs h-8 px-2 text-gray-600 hover:text-gray-900"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
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
  isEnabled?: boolean;
}

interface ClientData {
  id: string;
  name: string;
  slug: string;
  status?: string;
  timezone: string;
  clientType: string;
  campaignStartDate: string | null;
  platformConnections: Connection[];
  lastCollectedAt: string | null;
  latestPostDate: string | null;
  postCount: number;
}

type Activity = Record<string, { lastPostDateLocal: string | null; postsThisMonth: number; posts30: number }>;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50"
      >
        <span className="flex items-center gap-2 text-base font-semibold text-gray-900">
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          {title}
        </span>
        {hint && <span className="text-sm text-gray-500">{hint}</span>}
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </section>
  );
}

export function ClientDetailPageClient({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [client, setClient] = useState<ClientData | null>(null);
  const [activity, setActivity] = useState<Activity>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithRetry("/api/clients/" + clientId, undefined, 5);
        if (!r.ok) {
          if (r.status === 404) {
            router.replace("/clients");
            return;
          }
          throw new Error("HTTP " + r.status);
        }
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "load failed");
        if (!cancelled) {
          setClient(j.data);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't load this company");
          setLoading(false);
        }
      }
    })();
    // Posts this month / last 30 days — not fatal if it fails.
    fetch("/api/clients/activity")
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j?.success) setActivity(j.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-2xl">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-red-700 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900">Couldn&apos;t load this company</div>
            <div className="text-sm text-gray-600 mt-1">The server was busy. This is usually temporary.</div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  setTimeout(() => window.location.reload(), 100);
                }}
                className="h-9 px-3.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Try again
              </button>
              <Link
                href="/clients"
                className="h-9 px-3.5 inline-flex items-center text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                Back to Companies
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const act = activity[client.id];
  const conns = client.platformConnections.filter((c) => c.platform in COLLECTED_NETWORKS && c.isEnabled !== false);
  const broken = conns
    .filter((c) => c.connectionStatus === "ERROR" || c.connectionStatus === "EXPIRED")
    .map((c) => c.platform);
  const daysSince = daysSinceDate(act?.lastPostDateLocal ?? client.latestPostDate);
  const { verdict, reason } = judge({
    active: (client.status ?? "ACTIVE") === "ACTIVE",
    daysSince,
    networks: conns.map((c) => c.platform),
    brokenNetworks: broken,
    postsThisMonth: act?.postsThisMonth ?? 0,
  });
  const meta = VERDICT_META[verdict];
  const good = verdict === "ok";
  const next = NEXT_STEP[verdict];
  const missing = (["LINKEDIN", "TWITTER"] as const).filter((p) => !client.platformConnections.some((c) => c.platform === p));

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-[13px] font-medium text-gray-500 mb-1">
            <Link href="/clients" className="hover:text-gray-900">
              Companies
            </Link>
          </nav>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-gray-900">
            <ClientNameEditor clientId={client.id} initialName={client.name} />
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <ClientCategoryEditor clientId={client.id} initialClientType={client.clientType as never} />
            <span>
              {client.lastCollectedAt ? <>Data collected {formatRelative(client.lastCollectedAt)}</> : "No data collected yet"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/reports?clientId=${client.id}`}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <Calendar size={14} />
            Monthly report
          </Link>
          <ClientSyncButton clientId={client.id} />
        </div>
      </div>

      {/* Verdict */}
      <div
        className={
          "rounded-xl border px-6 py-5 flex items-start gap-4 " +
          (good ? "bg-green-50 border-green-200" : verdict === "paused" ? "bg-white border-gray-200" : "bg-red-50 border-red-200")
        }
      >
        {good ? (
          <CheckCircle2 className="text-green-700 flex-shrink-0 mt-0.5" size={28} />
        ) : verdict === "silent" ? (
          <XCircle className="text-red-700 flex-shrink-0 mt-0.5" size={28} />
        ) : (
          <AlertTriangle className={(verdict === "paused" ? "text-gray-500" : "text-red-700") + " flex-shrink-0 mt-0.5"} size={28} />
        )}
        <div>
          <div className={"text-xl font-semibold " + (good ? "text-green-900" : verdict === "paused" ? "text-gray-900" : "text-red-900")}>
            {meta.label}
          </div>
          <div className={"text-sm mt-0.5 " + (good ? "text-green-800" : verdict === "paused" ? "text-gray-600" : "text-red-800")}>
            {reason}
          </div>
          {next && (
            <div className="text-sm mt-2 text-gray-900">
              <span className="font-semibold">What to do: </span>
              {next}
            </div>
          )}
        </div>
      </div>

      {/* Three numbers */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-medium text-gray-600">Last post</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{lastPostLabel(daysSince)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-medium text-gray-600">Posts in the last 30 days</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{act ? act.posts30 : "—"}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-sm font-medium text-gray-600">Networks collected</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {conns.length === 0 && <span className="text-sm text-gray-600">None linked</span>}
            {conns.map((c) => {
              const ok = !broken.includes(c.platform);
              return (
                <span
                  key={c.id}
                  className={
                    "inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-md border " +
                    (ok ? "border-gray-200 text-gray-800" : "border-red-200 bg-red-50 text-red-700")
                  }
                >
                  <span className={"w-2 h-2 rounded-full " + (ok ? "bg-green-600" : "bg-red-600")} />
                  {COLLECTED_NETWORKS[c.platform]}
                  {!ok && " — not read"}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* The content */}
      <ClientContentTabs clientId={client.id} clientName={client.name} clientType={client.clientType} />

      {/* Folded away */}
      <Section title="Posting calendar" hint="Which days had a post, per network">
        <div className="p-5">
          <ComplianceDashboard clientId={client.id} platforms={client.platformConnections.map((c) => c.platform) as never[]} />
        </div>
      </Section>

      <Section
        title="Details"
        hint={missing.length ? `${missing.map((p) => PLATFORM_LABELS_MAP[p]).join(" and ")} not linked` : "Page links and dates"}
      >
        <div className="divide-y divide-gray-100">
          <div className="px-5 py-3 text-sm text-gray-600">
            {client.timezone} · <CampaignDateEditor clientId={client.id} initialDate={client.campaignStartDate} />
          </div>
          {conns.map((conn) => (
            <div key={conn.id} className="px-5 py-3 flex items-center gap-3">
              <PlatformIcon platform={conn.platform as never} size={28} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900">{PLATFORM_LABELS_MAP[conn.platform] ?? conn.platform}</div>
                <div className="text-xs text-gray-600 mt-0.5">
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
          {missing.map((platform) => (
            <div key={"missing-" + platform} className="px-5 py-3 flex items-center gap-3">
              <PlatformIcon platform={platform as never} size={28} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-700">
                  {PLATFORM_LABELS_MAP[platform]}
                  <span className="ml-2 text-xs text-gray-500">not linked</span>
                </div>
                <div className="mt-1">
                  <AddConnectionInline clientId={client.id} platform={platform} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
