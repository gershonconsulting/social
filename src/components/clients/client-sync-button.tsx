"use client";

import { useState } from "react";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Info } from "lucide-react";

interface PbResult {
  platform: string;
  postsUpserted: number;
  rowsParsed: number;
  error?: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  TIKTOK: "TikTok",
};

/**
 * Per-client manual sync trigger.
 *
 * The legacy `/api/sync` (type: backfill) path is unreliable in 2026 — the
 * Cloudflare edge runtime can't keep a LinkedIn Voyager / Twitter API
 * session long enough, Google Business OAuth tokens expire frequently, and
 * the worker often times out mid-sync returning HTML 524s. We've moved to
 * a two-tier model:
 *
 *   1. The GershonAI Chrome extension auto-runs daily inside the user's
 *      browser (real residential IP + real session, undetectable). It
 *      covers LinkedIn + X for every client in one batch.
 *   2. If the extension hasn't run (Chrome was closed), the daily 06:00
 *      UTC cron falls back to Phantombuster.
 *
 * This button gives the user a way to force-refresh data ad-hoc without
 * waiting for either of those. It calls Phantombuster directly (covers
 * LinkedIn + X for all clients, including this one). For LinkedIn/Twitter
 * the user can also just open the extension popup and click Sync Now.
 *
 * `clientId` is accepted but currently unused — kept for forward-compat
 * once per-client PB filtering is wired in.
 */
export function ClientSyncButton({ clientId: _clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PbResult[] | null>(null);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  async function handleSync() {
    setLoading(true);
    setResults(null);
    setTopLevelError(null);
    setShowResults(true);

    try {
      const res = await fetch("/api/cron/phantombuster-sync", { method: "GET" });
      setLoading(false);

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setTopLevelError(`Phantombuster returned HTTP ${res.status} — try the Chrome extension popup instead.`);
        return;
      }

      const data = await res.json().catch(() => null);
      if (!data) {
        setTopLevelError("Could not parse Phantombuster response.");
        return;
      }
      if (!data.success) {
        setTopLevelError(data.error || "Phantombuster sync failed.");
        return;
      }
      const items = (data?.data?.results || []) as PbResult[];
      setResults(items);
      const allFailed = items.length > 0 && items.every((r) => !!r.error);
      if (allFailed) {
        setTopLevelError("Both phantoms ran but returned 0 rows — check Phantombuster saved arguments.");
      }
    } catch (e) {
      setLoading(false);
      setTopLevelError(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={handleSync}
        disabled={loading}
        title="Refresh LinkedIn + X data for all clients via Phantombuster"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {loading ? "Running Phantombuster…" : "Refresh via Phantombuster"}
      </button>

      {showResults && (loading || results || topLevelError) && (
        <div className="absolute right-0 top-full mt-2 z-30 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              {loading ? "Launching phantoms…" : "Phantombuster results"}
            </span>
            {!loading && (
              <button
                onClick={() => setShowResults(false)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Close
              </button>
            )}
          </div>
          <div className="px-4 py-2 text-[11px] text-gray-500 bg-blue-50 border-b border-blue-100">
            <Info size={11} className="inline mr-1 text-blue-500" />
            Phantombuster refreshes LinkedIn + X for <strong>all</strong> clients.
            For just this client, click Sync Now in the GershonAI extension popup.
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {loading && (
              <div className="px-4 py-6 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                Running the LinkedIn + Twitter phantoms in Phantombuster…
              </div>
            )}
            {topLevelError && !loading && (
              <div className="px-4 py-3 text-xs text-red-700 bg-red-50">
                <AlertTriangle size={12} className="inline mr-1" />
                {topLevelError}
              </div>
            )}
            {results?.map((r) => (
              <div key={r.platform} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900">
                    {PLATFORM_LABELS[r.platform] ?? r.platform}
                  </span>
                  {r.error ? (
                    <AlertTriangle size={14} className="text-red-500" />
                  ) : (
                    <CheckCircle2 size={14} className="text-green-500" />
                  )}
                </div>
                {r.error ? (
                  <div className="text-red-700">{r.error}</div>
                ) : (
                  <div className="text-gray-600">
                    {r.postsUpserted} post{r.postsUpserted !== 1 ? "s" : ""} upserted from {r.rowsParsed} rows
                  </div>
                )}
              </div>
            ))}
          </div>
          {!loading && results && results.some((r) => (r.postsUpserted || 0) > 0) && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Reload to see fresh data</span>
              <button
                onClick={() => window.location.assign(window.location.pathname + window.location.search)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Reload now
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
