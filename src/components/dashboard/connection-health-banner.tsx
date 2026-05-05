"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";

interface Counts {
  connected: number;
  expired: number;
  error: number;
  pending: number;
  disconnected: number;
  total: number;
}

interface NeedsAttention {
  id: string;
  clientId: string;
  clientName: string;
  platform: string;
  status: string;
  reason: string;
}

interface Health {
  summary: Counts;
  byPlatform: Record<string, Counts>;
  needsAttention: NeedsAttention[];
  healthy: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
};

export function ConnectionHealthBanner() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/health/connections", { cache: "no-store" });
      const j = await r.json();
      if (j.success) setHealth(j.data);
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function runTestAll() {
    if (!health) return;
    setRunning(true);
    try {
      // Probe every connection, in parallel for speed
      const ids: string[] = [];
      for (const p of Object.keys(health.byPlatform)) {
        // Re-fetch active connections to test by id — simplest path:
      }
      // Use the /api/clients data dump to enumerate connection ids
      const cls = await fetch("/api/clients", { cache: "no-store" }).then((r) => r.json());
      const allIds: string[] = [];
      for (const c of (cls?.data || [])) {
        for (const conn of (c.platformConnections || [])) {
          if (conn.id) allIds.push(conn.id);
        }
      }
      // Probe sequentially (cheaper on edge)
      for (const id of allIds) {
        try { await fetch(`/api/platforms/${id}/test`, { method: "POST" }); } catch {}
      }
      await load();
    } finally {
      setRunning(false);
    }
  }

  if (loading) return null;
  if (!health) return null;

  const broken = health.summary.total - health.summary.connected;
  if (broken === 0) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2 mb-4 bg-green-50 border border-green-200 rounded-lg">
        <span className="inline-flex items-center gap-2 text-sm text-green-800">
          <CheckCircle2 size={14} className="text-green-600" />
          All {health.summary.total} platform connections healthy
        </span>
        <button
          onClick={runTestAll}
          disabled={running}
          className="text-xs text-green-700 hover:underline inline-flex items-center gap-1 disabled:opacity-60"
        >
          {running ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Re-test
        </button>
      </div>
    );
  }

  // Build a per-platform summary string
  const perPlat = Object.entries(health.byPlatform)
    .map(([p, c]) => {
      const bad = c.total - c.connected;
      return bad > 0 ? `${PLATFORM_LABELS[p] ?? p}: ${bad}/${c.total} broken` : null;
    })
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="px-4 py-3 mb-4 bg-amber-50 border border-amber-300 rounded-lg">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-amber-900">
              {broken} of {health.summary.total} platform connection{health.summary.total !== 1 ? "s" : ""} need attention
            </div>
            <div className="text-xs text-amber-800 mt-0.5">
              Reports and dashboards are computed from synced data. Until these reconnect, those numbers will be stale.
            </div>
            {perPlat && <div className="text-xs text-amber-700 mt-1 font-medium">{perPlat}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={runTestAll}
            disabled={running}
            className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 disabled:opacity-60 inline-flex items-center gap-1"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {running ? "Testing…" : "Re-test"}
          </button>
          <Link
            href="/settings"
            className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
          >
            Fix in Settings
          </Link>
        </div>
      </div>

      {expanded && health.needsAttention.length > 0 && (
        <div className="mt-3 max-h-64 overflow-y-auto bg-white rounded-lg border border-amber-200 divide-y divide-amber-50">
          {health.needsAttention.slice(0, 50).map((n) => (
            <div key={n.id} className="px-3 py-2 text-xs flex items-start gap-2">
              <Link href={`/clients/${n.clientId}`} className="font-medium text-blue-700 hover:underline w-32 shrink-0 truncate" title={n.clientName}>
                {n.clientName}
              </Link>
              <span className="text-gray-500 w-24 shrink-0">{PLATFORM_LABELS[n.platform] ?? n.platform}</span>
              <span className="font-semibold text-red-700 w-16 shrink-0">{n.status}</span>
              <span className="text-gray-700 truncate" title={n.reason}>{n.reason}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-xs text-amber-800 hover:underline"
      >
        {expanded ? "Hide" : "Show"} all {health.needsAttention.length} affected connections
      </button>
    </div>
  );
}
