"use client";

import { useState } from "react";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

interface PlatformResult {
  platform: string;
  phantomId: string | null;
  launched: boolean;
  finished: string | null;
  rowsParsed: number;
  postsUpserted: number;
  error?: string;
  deleted?: boolean;
}

/**
 * Manual trigger for the Phantombuster cron. Useful for testing the
 * integration on a single client (currently configured: Gershon Consulting)
 * without waiting for the daily cron.
 */
export function PhantombusterSyncButton({ clientId }: { clientId?: string }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PlatformResult[] | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function run() {
    setRunning(true);
    setResults(null);
    setTopError(null);
    setOpen(true);
    try {
      const url = clientId
        ? `/api/cron/phantombuster-sync?clientId=${encodeURIComponent(clientId)}`
        : `/api/cron/phantombuster-sync`;
      const r = await fetch(url);
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setTopError(`Phantombuster sync returned a non-JSON response (HTTP ${r.status}).`);
        setRunning(false);
        return;
      }
      const j = await r.json();
      if (j.success && Array.isArray(j.data?.results)) {
        setResults(j.data.results as PlatformResult[]);
      } else {
        setTopError(j.error || "Phantombuster sync did not return results.");
      }
    } catch (e) {
      setTopError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#0A66C2] rounded-lg hover:bg-[#0852a0] disabled:opacity-60"
        title="Launch the configured Phantombuster phantoms, wait for them to finish, and import the posts they collected"
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {running ? "Running phantoms…" : "Sync via Phantombuster"}
      </button>

      {open && (running || results || topError) && (
        <div className="absolute right-0 top-full mt-2 z-30 w-96 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              {running ? "Running Phantombuster…" : "Phantombuster results"}
            </span>
            {!running && (
              <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {running && (
              <div className="px-4 py-6 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                Launching phantoms, waiting for completion (up to 2 min)…
              </div>
            )}
            {topError && !running && (
              <div className="px-4 py-3 text-xs text-red-700 bg-red-50 inline-flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{topError}</span>
              </div>
            )}
            {results?.map((r) => (
              <div key={r.platform} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900">{r.platform}</span>
                  {r.error ? (
                    <AlertTriangle size={14} className="text-red-500" />
                  ) : (
                    <CheckCircle2 size={14} className="text-green-500" />
                  )}
                </div>
                {r.error ? (
                  <div className="text-red-700 break-words">{r.error}</div>
                ) : (
                  <div className="text-gray-600">
                    Phantom {r.phantomId} · finished {r.finished} · parsed {r.rowsParsed} rows · {r.postsUpserted} posts upserted{r.deleted ? " · phantom deleted" : ""}
                  </div>
                )}
              </div>
            ))}
            {!running && results && results.length === 0 && !topError && (
              <div className="px-4 py-6 text-center text-xs text-gray-500">
                Phantombuster returned no platform results. Check the API key + phantom IDs in Settings.
              </div>
            )}
          </div>
          {!running && results && results.some((r) => (r.postsUpserted ?? 0) > 0) && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Reload the page to see the new posts.</span>
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
