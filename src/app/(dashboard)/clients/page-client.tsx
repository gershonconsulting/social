"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, RefreshCw, Loader2, Linkedin, Twitter, MapPin } from "lucide-react";
import { Header } from "@/components/layout/header";
import { ConnectionBadge } from "@/components/ui/connection-badge";
import { formatDate, formatRelative } from "@/lib/utils";
import { inferCleanName } from "@/lib/clients/clean-name";

interface PlatformConn {
  platform: string;
  connectionStatus: string;
  lastSyncAt: string | null;
  isMandatory?: boolean;
  externalAccountUrl?: string | null;
  lastSyncError?: string | null;
}

interface Client {
  id: string;
  slug: string;
  name: string;
  status: string;
  clientType: string | null;
  campaignStartDate: string | null;
  platformConnections: PlatformConn[];
}

const CLIENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  INCOMPLETE_SETUP: "Incomplete Setup",
  ARCHIVED: "Archived",
};

const CATEGORY_BADGE: Record<string, string> = {
  CLIENT: "bg-blue-50 text-blue-700",
  PROSPECT: "bg-purple-50 text-purple-700",
  PARTNER: "bg-teal-50 text-teal-700",
  COMPETITION: "bg-orange-50 text-orange-700",
  COMPANY: "bg-emerald-50 text-emerald-700",
  INTERNAL: "bg-gray-100 text-gray-600",
};

export function ClientsPageClient() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  const applySuggestedName = async (clientId: string, suggestion: string) => {
    setRenaming(clientId);
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: suggestion }),
      });
      if (r.ok) {
        setClients((prev) => prev?.map((c) => (c.id === clientId ? { ...c, name: suggestion } : c)) ?? prev);
      }
    } catch {}
    finally {
      setRenaming(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      let lastErr = "";
      for (let i = 0; i < 3; i++) {
        // 12s per-attempt timeout so a hung worker can't freeze the loading state forever
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const r = await fetch("/api/clients?light=1", { cache: "no-store", signal: ctrl.signal });
          clearTimeout(timer);
          if (!r.ok) {
            let body: { error?: string } | null = null;
            try { body = await r.json(); } catch {}
            lastErr = body?.error || `HTTP ${r.status}`;
          } else {
            const j = await r.json();
            if (!cancelled) {
              setClients(j?.data ?? []);
              setLoading(false);
            }
            return;
          }
        } catch (e) {
          clearTimeout(timer);
          lastErr = e instanceof Error
            ? (e.name === "AbortError" ? "Request timed out (12s)" : e.message)
            : "Network error";
        }
        await new Promise((res) => setTimeout(res, 250 * (i + 1)));
      }
      if (!cancelled) {
        setError(lastErr || "Could not load companies");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const visibleClients = useMemo(() => {
    if (!clients) return null;
    if (categoryFilter === "ALL") return clients;
    return clients.filter((c) => (c.clientType ?? "").toUpperCase() === categoryFilter);
  }, [clients, categoryFilter]);

  const summary = useMemo(() => {
    if (!visibleClients) return "";
    const active = visibleClients.filter((c) => c.status === "ACTIVE").length;
    const totalLabel = categoryFilter === "ALL" ? "total" : categoryFilter.charAt(0) + categoryFilter.slice(1).toLowerCase();
    return `${active} active · ${visibleClients.length} ${totalLabel}`;
  }, [visibleClients, categoryFilter]);

  return (
    <div>
      <Header
        title="Companies"
        subtitle={summary || "Loading…"}
        actions={
          <Link
            href="/admin?tab=clients&action=new"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#FE1B04] rounded-lg hover:bg-[#d11200] transition-colors"
          >
            <Plus size={15} />
            Add Company
          </Link>
        }
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading companies…
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md mt-8 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto text-amber-600 mb-2" />
          <div className="text-sm font-semibold text-amber-900">
            Could not load companies
          </div>
          <div className="text-xs text-amber-800 mt-1">{error}</div>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && clients && (
        <>
          {/* Category tabs */}
          <div className="flex flex-wrap gap-1.5 mb-4 pb-3">
            {[
              { key: "ALL", label: "All" },
              { key: "CAMPAIGN", label: "Campaign" },
              { key: "CLIENT", label: "Client" },
              { key: "PROSPECT", label: "Prospect" },
              { key: "PARTNER", label: "Partner" },
              { key: "COMPETITION", label: "Competition" },
              { key: "INTERNAL", label: "Internal" },
            ].map((t) => {
              const count = t.key === "ALL"
                ? clients.length
                : clients.filter((c) => (c.clientType ?? "").toUpperCase() === t.key).length;
              const active = categoryFilter === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setCategoryFilter(t.key)}
                  className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                    active
                      ? "bg-red-600 text-white"
                      : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-xs ${active ? "text-red-100" : "text-gray-400"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-6 py-3 font-medium text-gray-500">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Platforms</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Campaign Start</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Last Sync</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(visibleClients ?? []).map((client) => {
                  const errorConns = client.platformConnections.filter(
                    (c) => c.connectionStatus === "ERROR" || c.connectionStatus === "EXPIRED"
                  );
                  const lastSync = client.platformConnections
                    .map((c) => c.lastSyncAt)
                    .filter(Boolean)
                    .sort()
                    .reverse()[0];
                  const ct = client.clientType || "";
                  const ctLabel = ct ? ct.charAt(0) + ct.slice(1).toLowerCase() : "—";
                  return (
                    <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <Link
                          href={`/clients/${client.id}`}
                          className="font-medium text-gray-900 hover:text-red-600"
                        >
                          {client.name}
                        </Link>
                        <div className="text-xs text-gray-400 mt-0.5">{client.slug}</div>
                        {(() => {
                          // Show clickable platform links (LinkedIn / X / Google Business) under the name
                          const linkFor = (platform: string) =>
                            client.platformConnections.find(
                              (c) => c.platform === platform && c.externalAccountUrl,
                            )?.externalAccountUrl ?? null;
                          const li = linkFor("LINKEDIN");
                          const tw = linkFor("TWITTER");
                          const gb = linkFor("GOOGLE_BUSINESS");
                          if (!li && !tw && !gb) return null;
                          // Show the full URL text alongside each icon — Olivier wants the
                          // actual URL visible without hovering, so each platform gets its
                          // own line with the icon + clickable URL.
                          const stripScheme = (u: string) =>
                            u.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/$/, "");
                          return (
                            <div className="mt-1.5 flex flex-col gap-0.5 text-[11px]">
                              {li && (
                                <a
                                  href={li}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title={li}
                                  className="inline-flex items-center gap-1.5 text-[#0A66C2] hover:underline truncate max-w-[280px]"
                                >
                                  <Linkedin size={12} className="shrink-0" />
                                  <span className="truncate">{stripScheme(li)}</span>
                                </a>
                              )}
                              {tw && (
                                <a
                                  href={tw}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title={tw}
                                  className="inline-flex items-center gap-1.5 text-gray-800 hover:underline truncate max-w-[280px]"
                                >
                                  <Twitter size={12} className="shrink-0" />
                                  <span className="truncate">{stripScheme(tw)}</span>
                                </a>
                              )}
                              {gb && (
                                <a
                                  href={gb}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  title={gb}
                                  className="inline-flex items-center gap-1.5 text-[#34A853] hover:underline truncate max-w-[280px]"
                                >
                                  <MapPin size={12} className="shrink-0" />
                                  <span className="truncate">{stripScheme(gb)}</span>
                                </a>
                              )}
                            </div>
                          );
                        })()}
                        {(() => {
                          const suggested = inferCleanName(client.name);
                          if (suggested && suggested !== client.name && suggested.length >= 2) {
                            const isSaving = renaming === client.id;
                            return (
                              <button
                                onClick={() => !isSaving && applySuggestedName(client.id, suggested)}
                                disabled={isSaving}
                                title={`Original: ${client.name}`}
                                className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-full px-2 py-0.5 disabled:opacity-50"
                              >
                                {isSaving ? "Renaming…" : `Use "${suggested}"`}
                              </button>
                            );
                          }
                          return null;
                        })()}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_BADGE[ct] ?? "bg-gray-50 text-gray-500"}`}>
                          {ctLabel}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            client.status === "ACTIVE"
                              ? "bg-green-50 text-green-700"
                              : client.status === "PAUSED"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-gray-50 text-gray-500"
                          }`}
                        >
                          {CLIENT_STATUS_LABELS[client.status] ?? client.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1">
                          {client.platformConnections.map((conn) => (
                            <ConnectionBadge key={conn.platform} status={conn.connectionStatus} lastSyncError={conn.lastSyncError} />
                          ))}
                          {client.platformConnections.length === 0 && (
                            <span className="text-xs text-gray-400">No platforms</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-500">
                        {formatDate(client.campaignStartDate)}
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-500">
                        {formatRelative(lastSync ?? undefined)}
                      </td>
                      <td className="px-4 py-4">
                        {errorConns.length > 0 ? (
                          <span className="text-xs text-red-600 font-medium">
                            {errorConns.length} error{errorConns.length !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">None</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(visibleClients?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-400">
                      {categoryFilter === "ALL"
                        ? "No companies yet. Add one above."
                        : `No companies in '${categoryFilter.charAt(0) + categoryFilter.slice(1).toLowerCase()}' yet.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
