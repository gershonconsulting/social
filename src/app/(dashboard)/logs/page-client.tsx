"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { Header } from "@/components/layout/header";

interface PlatformResult {
  platform: string;
  externalAccountName: string | null;
  postsUpserted: number;
  followerCount: number | null;
  success: boolean;
  error: string | null;
}

interface SyncJob {
  id: string;
  jobType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  errorLogJson: string | null;
  resultsJson: string | null;
  notes: string | null;
  scopeType: string | null;
  client: { name: string; slug: string } | null;
  triggeredBy: { name: string | null; email: string | null } | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
};

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: "bg-green-50 text-green-700",
  FAILED: "bg-red-50 text-red-700",
  PARTIAL: "bg-amber-50 text-amber-700",
  RUNNING: "bg-blue-50 text-blue-700",
  CANCELLED: "bg-gray-50 text-gray-500",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(start: string, end: string | null) {
  if (!end) return "running…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function LogsPageClient() {
  const [jobs, setJobs] = useState<SyncJob[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      let lastErr = "";
      for (let i = 0; i < 5; i++) {
        try {
          const r = await fetch("/api/jobs?limit=200", { cache: "no-store" });
          const ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) {
            lastErr = `HTTP ${r.status}`;
          } else {
            const j = await r.json();
            if (!cancelled) {
              setJobs(j?.data ?? []);
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
        setError(lastErr || "Could not load logs");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = (jobs ?? []).filter((j) =>
    statusFilter === "ALL" ? true : j.status === statusFilter
  );

  const summary = jobs ? {
    total: jobs.length,
    completed: jobs.filter((j) => j.status === "COMPLETED").length,
    partial: jobs.filter((j) => j.status === "PARTIAL").length,
    failed: jobs.filter((j) => j.status === "FAILED").length,
    running: jobs.filter((j) => j.status === "RUNNING").length,
  } : null;

  return (
    <div className="space-y-6">
      <Header
        title="Sync log"
        subtitle="Recent data-collection runs across every connected platform"
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

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { key: "ALL", label: "All", n: summary.total, css: "bg-gray-50 text-gray-700" },
            { key: "COMPLETED", label: "Completed", n: summary.completed, css: "bg-green-50 text-green-700" },
            { key: "PARTIAL", label: "Partial", n: summary.partial, css: "bg-amber-50 text-amber-700" },
            { key: "FAILED", label: "Failed", n: summary.failed, css: "bg-red-50 text-red-700" },
            { key: "RUNNING", label: "Running", n: summary.running, css: "bg-blue-50 text-blue-700" },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              className={`rounded-xl border p-3 text-left transition-colors ${statusFilter === s.key ? "border-red-300 ring-1 ring-red-200" : "border-gray-200"}`}
            >
              <div className={`text-xs font-medium uppercase tracking-wide rounded px-2 py-0.5 inline-block ${s.css}`}>
                {s.label}
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1.5">{s.n}</div>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading sync log…
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md mt-4 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto text-amber-600 mb-2" />
          <div className="text-sm font-semibold text-amber-900">Could not load sync log</div>
          <div className="text-xs text-amber-800 mt-1">{error}</div>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && jobs && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 w-6"></th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">When</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Type</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Company</th>
                <th className="text-center px-4 py-2 font-medium text-gray-500 text-xs">Status</th>
                <th className="text-center px-4 py-2 font-medium text-gray-500 text-xs">Results</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Duration</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Triggered by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-sm text-gray-400">No sync jobs in this view.</td></tr>
              )}
              {filtered.map((job) => {
                const isOpen = expanded.has(job.id);
                const errors: string[] = (() => {
                  if (!job.errorLogJson) return [];
                  try { const e = JSON.parse(job.errorLogJson); return Array.isArray(e) ? e : [String(e)]; } catch { return [job.errorLogJson]; }
                })();
                const hasDetail = errors.length > 0 || !!job.notes;
                return (
                  <>
                    <tr key={job.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">
                        {hasDetail && (
                          <button onClick={() => toggle(job.id)}>
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{fmtDate(job.startedAt)}</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{job.jobType}</td>
                      <td className="px-4 py-2 text-xs text-gray-700">{job.client?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[job.status] ?? "bg-gray-50 text-gray-500"}`}>{job.status}</span>
                      </td>
                      <td className="px-4 py-2 text-center text-xs">
                        <span className="text-green-700">{job.itemsSucceeded}</span>
                        {" / "}
                        <span className="text-gray-500">{job.itemsProcessed}</span>
                        {job.itemsFailed > 0 && <span className="text-red-700">{" · " + job.itemsFailed + " failed"}</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDuration(job.startedAt, job.finishedAt)}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 truncate max-w-[160px]">{job.triggeredBy?.name ?? job.triggeredBy?.email ?? "system"}</td>
                    </tr>
                    {isOpen && (
                      <tr key={job.id + "-d"} className="bg-gray-50">
                        <td colSpan={8} className="px-8 py-3 text-xs">
                          {job.notes && (<div className="mb-2"><span className="font-semibold">Notes:</span> <span className="text-gray-700">{job.notes}</span></div>)}
                          {(() => {
                            let perPlatform: PlatformResult[] = [];
                            if (job.resultsJson) {
                              try {
                                const parsed = JSON.parse(job.resultsJson);
                                if (Array.isArray(parsed)) perPlatform = parsed as PlatformResult[];
                              } catch {}
                            }
                            if (perPlatform.length === 0) return null;
                            return (
                              <div className="mb-3">
                                <div className="font-semibold mb-1">Per-platform breakdown:</div>
                                <table className="w-full text-xs border border-gray-200 bg-white rounded">
                                  <thead className="bg-gray-100">
                                    <tr>
                                      <th className="text-left px-2 py-1 font-medium">Platform</th>
                                      <th className="text-left px-2 py-1 font-medium">Account</th>
                                      <th className="text-center px-2 py-1 font-medium">Posts upserted</th>
                                      <th className="text-center px-2 py-1 font-medium">Follower count</th>
                                      <th className="text-left px-2 py-1 font-medium">Result</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {perPlatform.map((p) => (
                                      <tr key={p.platform}>
                                        <td className="px-2 py-1">{PLATFORM_LABELS[p.platform] ?? p.platform}</td>
                                        <td className="px-2 py-1 text-gray-500">{p.externalAccountName ?? "—"}</td>
                                        <td className="px-2 py-1 text-center">{p.postsUpserted}</td>
                                        <td className="px-2 py-1 text-center">{p.followerCount ?? "—"}</td>
                                        <td className="px-2 py-1">
                                          {p.success ? (
                                            <span className="text-green-700">OK</span>
                                          ) : (
                                            <span className="text-red-700" title={p.error || ""}>{(p.error || "Failed").slice(0, 80)}</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })()}
                          {errors.length > 0 && (
                            <div>
                              <div className="font-semibold mb-1">Errors ({errors.length}):</div>
                              <ul className="list-disc ml-5 text-red-700 space-y-0.5">
                                {errors.map((e, i) => <li key={i}>{e}</li>)}
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
        </div>
      )}
    </div>
  );
}
