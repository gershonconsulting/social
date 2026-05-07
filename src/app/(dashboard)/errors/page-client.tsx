"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Loader2, ChevronRight, ChevronDown, ExternalLink, CheckCircle2 } from "lucide-react";
import { Header } from "@/components/layout/header";

interface ActiveIssue {
  id: string;
  clientId: string;
  clientName: string;
  platform: string;
  status: string;
  lastSyncAt: string | null;
  error: string | null;
  recommendedFix: string;
}

interface PlatformResult {
  platform: string;
  success: boolean;
  error: string | null;
  postsUpserted: number;
}

interface RecentFailure {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  clientId: string | null;
  clientName: string | null;
  status: string;
  itemsProcessed: number;
  itemsFailed: number;
  itemsSucceeded: number;
  perPlatform: PlatformResult[];
  errorLog: string[];
}

interface ErrorsData {
  activeIssues: ActiveIssue[];
  recentFailures: RecentFailure[];
  summary: {
    activeCount: number;
    recentFailedCount: number;
    byPlatform: Record<string, number>;
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtRelative(iso: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ErrorsPageClient() {
  const [data, setData] = useState<ErrorsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [platformFilter, setPlatformFilter] = useState<string>("ALL");
  const [openJobs, setOpenJobs] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      let lastErr = "";
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch("/api/errors", { cache: "no-store" });
          const ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) {
            lastErr = `HTTP ${r.status}`;
          } else {
            const j = await r.json();
            if (!cancelled) {
              if (j.success) setData(j.data);
              else lastErr = j.error || "Failed";
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
        setError(lastErr || "Could not load errors");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  function toggleJob(id: string) {
    setOpenJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filteredIssues = (data?.activeIssues ?? []).filter(
    (i) => platformFilter === "ALL" || i.platform === platformFilter
  );

  const filteredFailures = (data?.recentFailures ?? []).filter(
    (f) =>
      platformFilter === "ALL" ||
      f.perPlatform.some((p) => p.platform === platformFilter)
  );

  return (
    <div className="space-y-6">
      <Header
        title="Errors & diagnostics"
        subtitle="Everything currently broken or recently failed, with the recommended fix"
        actions={
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        }
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md mt-4 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto text-amber-600 mb-2" />
          <div className="text-sm font-semibold text-amber-900">Could not load errors</div>
          <div className="text-xs text-amber-800 mt-1">{error}</div>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary cards / platform filter */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: "ALL", label: "All issues", n: data.summary.activeCount, css: "bg-gray-50 text-gray-700" },
              { key: "LINKEDIN", label: "LinkedIn", n: data.summary.byPlatform.LINKEDIN ?? 0, css: "bg-blue-50 text-blue-700" },
              { key: "TWITTER", label: "X / Twitter", n: data.summary.byPlatform.TWITTER ?? 0, css: "bg-gray-100 text-gray-700" },
              { key: "GOOGLE_BUSINESS", label: "Google Business", n: data.summary.byPlatform.GOOGLE_BUSINESS ?? 0, css: "bg-emerald-50 text-emerald-700" },
            ].map((c) => (
              <button
                key={c.key}
                onClick={() => setPlatformFilter(c.key)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  platformFilter === c.key ? "border-red-300 ring-1 ring-red-200" : "border-gray-200"
                }`}
              >
                <div className={`text-xs font-medium uppercase tracking-wide rounded px-2 py-0.5 inline-block ${c.css}`}>
                  {c.label}
                </div>
                <div className="text-2xl font-bold text-gray-900 mt-1.5">{c.n}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">connections affected</div>
              </button>
            ))}
          </div>

          {/* Active issues */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Active issues</h2>
                <p className="text-xs text-gray-500 mt-0.5">Connections currently in a bad state. Each row tells you the cause and how to fix it.</p>
              </div>
            </div>
            {filteredIssues.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-gray-400 inline-flex items-center justify-center w-full gap-2">
                <CheckCircle2 size={16} className="text-green-500" />
                {platformFilter === "ALL"
                  ? "No active issues — every connection is healthy."
                  : `No active issues for ${PLATFORM_LABEL[platformFilter] ?? platformFilter}.`}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Company</th>
                    <th className="text-left px-4 py-2 font-medium">Platform</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Last sync</th>
                    <th className="text-left px-4 py-2 font-medium">What went wrong</th>
                    <th className="text-left px-4 py-2 font-medium">Recommended fix</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredIssues.map((i) => (
                    <tr key={i.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-2 text-xs">
                        <Link href={`/clients/${i.clientId}`} className="text-blue-700 hover:underline inline-flex items-center gap-1">
                          {i.clientName}
                          <ExternalLink size={10} />
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-xs">{PLATFORM_LABEL[i.platform] ?? i.platform}</td>
                      <td className="px-4 py-2 text-xs">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          i.status === "ERROR" ? "bg-red-50 text-red-700"
                          : i.status === "EXPIRED" ? "bg-amber-50 text-amber-700"
                          : i.status === "PENDING" ? "bg-gray-100 text-gray-600"
                          : "bg-yellow-50 text-yellow-700"
                        }`}>
                          {i.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtRelative(i.lastSyncAt)}</td>
                      <td className="px-4 py-2 text-xs text-red-700 max-w-md break-words">{i.error || "—"}</td>
                      <td className="px-4 py-2 text-xs text-gray-700 max-w-md">{i.recommendedFix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent failed runs */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Recent failures</h2>
                <p className="text-xs text-gray-500 mt-0.5">Last 100 sync runs that failed or partially failed. Click a row to see per-platform reasons.</p>
              </div>
              <Link href="/logs" className="text-xs text-blue-600 hover:underline">Open full sync log →</Link>
            </div>
            {filteredFailures.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-gray-400">
                {platformFilter === "ALL"
                  ? "No recent failed runs."
                  : `No recent failed runs touching ${PLATFORM_LABEL[platformFilter] ?? platformFilter}.`}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 w-6"></th>
                    <th className="text-left px-3 py-2 font-medium">When</th>
                    <th className="text-left px-3 py-2 font-medium">Company</th>
                    <th className="text-center px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Platforms hit</th>
                    <th className="text-left px-3 py-2 font-medium">Top error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredFailures.map((f) => {
                    const isOpen = openJobs.has(f.id);
                    const failedPlats = f.perPlatform.filter((p) => !p.success);
                    const platformsLabel = f.perPlatform.length > 0
                      ? f.perPlatform.map((p) => PLATFORM_LABEL[p.platform] ?? p.platform).join(" · ")
                      : "—";
                    const topError = failedPlats[0]?.error || f.errorLog[0] || "—";
                    return (
                      <>
                        <tr key={f.id} className="hover:bg-gray-50 align-top">
                          <td className="px-3 py-2">
                            <button onClick={() => toggleJob(f.id)} className="text-gray-400 hover:text-gray-700">
                              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{fmtDate(f.startedAt)}</td>
                          <td className="px-3 py-2 text-xs text-gray-700">
                            {f.clientId ? (
                              <Link href={`/clients/${f.clientId}`} className="hover:underline text-blue-700">{f.clientName ?? "?"}</Link>
                            ) : "—"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                              f.status === "FAILED" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                            }`}>{f.status}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600">{platformsLabel}</td>
                          <td className="px-3 py-2 text-xs text-red-700 max-w-md truncate" title={topError}>{topError}</td>
                        </tr>
                        {isOpen && (
                          <tr key={f.id + "-d"} className="bg-gray-50">
                            <td colSpan={6} className="px-8 py-3">
                              {f.perPlatform.length > 0 && (
                                <table className="w-full text-xs border border-gray-200 bg-white rounded mb-2">
                                  <thead className="bg-gray-100">
                                    <tr>
                                      <th className="text-left px-2 py-1 font-medium">Platform</th>
                                      <th className="text-center px-2 py-1 font-medium">Posts</th>
                                      <th className="text-left px-2 py-1 font-medium">Result</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {f.perPlatform.map((p) => (
                                      <tr key={p.platform}>
                                        <td className="px-2 py-1">{PLATFORM_LABEL[p.platform] ?? p.platform}</td>
                                        <td className="px-2 py-1 text-center">{p.postsUpserted}</td>
                                        <td className="px-2 py-1">
                                          {p.success ? <span className="text-green-700">OK</span> : <span className="text-red-700">{p.error || "Failed"}</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              {f.errorLog.length > 0 && (
                                <div className="text-xs">
                                  <div className="font-semibold mb-1">Run-level errors:</div>
                                  <ul className="list-disc ml-5 text-red-700 space-y-0.5">
                                    {f.errorLog.map((e, i) => <li key={i}>{e}</li>)}
                                  </ul>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
