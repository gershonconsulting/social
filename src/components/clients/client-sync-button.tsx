"use client";

import { useState, useEffect, useRef } from "react";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Info, Chrome } from "lucide-react";

interface PlatformResult {
  platform: string;
  postsUpserted: number;
  rowsParsed?: number;
  error?: string;
}

interface SyncResultData {
  ok: boolean;
  totalUpserted?: number;
  totalFailed?: number;
  accountCount?: number;
  badPlatforms?: string[];
  ingestErrors?: string[];
  results?: PlatformResult[];
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  TIKTOK: "TikTok",
};

/**
 * Per-client manual sync.
 *
 * Primary path: drive the GershonAI Chrome extension via window.postMessage.
 *   The extension's content script (running on social.gershoncrm.com) listens
 *   for GERSHONAI_SYNC_CLIENT messages and forwards them to its background
 *   service worker, which opens LinkedIn + X tabs and scrapes just this one
 *   client. Real residential IP, real session, full extension flow — same as
 *   the daily auto-sync but scoped to one company.
 *
 * Fallback: if the extension isn't installed or the user runs this from a
 *   browser without it, fall through to /api/cron/phantombuster-sync (which
 *   syncs all clients via PB's infra).
 *
 * Detection: on mount, we postMessage GERSHONAI_PING. If we receive a
 *   GERSHONAI_PONG within 1 second, the extension is installed and we use
 *   the extension path. Otherwise we render the Phantombuster path.
 */
export function ClientSyncButton({ clientId }: { clientId: string }) {
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [extensionChecked, setExtensionChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PlatformResult[] | null>(null);
  const [summary, setSummary] = useState<SyncResultData | null>(null);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  // Probe for the extension on mount.
  useEffect(() => {
    let cancelled = false;
    const pingId = "ping-" + Math.random().toString(36).slice(2);
    function onMessage(evt: MessageEvent) {
      if (evt.source !== window) return;
      if (evt.origin !== location.origin) return;
      const d = evt.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "GERSHONAI_HELLO" || (d.type === "GERSHONAI_PONG" && d.requestId === pingId)) {
        if (!cancelled) {
          setExtensionVersion(d.version || "unknown");
          setExtensionChecked(true);
        }
      }
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "GERSHONAI_PING", requestId: pingId }, location.origin);
    const timer = setTimeout(() => {
      if (!cancelled) setExtensionChecked(true);
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  async function handleSyncViaExtension() {
    setLoading(true);
    setResults(null);
    setSummary(null);
    setTopLevelError(null);
    setShowResults(true);
    const requestId = "sync-" + Math.random().toString(36).slice(2);
    requestIdRef.current = requestId;

    return new Promise<void>((resolve) => {
      const onMessage = (evt: MessageEvent) => {
        if (evt.source !== window) return;
        if (evt.origin !== location.origin) return;
        const d = evt.data;
        if (!d || typeof d !== "object") return;
        if (d.type !== "GERSHONAI_SYNC_RESULT") return;
        if (d.requestId !== requestId) return;
        window.removeEventListener("message", onMessage);
        setLoading(false);
        if (!d.ok) {
          setTopLevelError(d.error || "Extension sync failed");
          resolve();
          return;
        }
        const r: SyncResultData = d.result || {};
        setSummary(r);
        if ((r.badPlatforms || []).length > 0) {
          setTopLevelError("Cookie capture failed for: " + r.badPlatforms!.join(", "));
        }
        resolve();
      };
      window.addEventListener("message", onMessage);

      // Send to content script → background → runFullSync filtered to this client.
      window.postMessage({
        type: "GERSHONAI_SYNC_CLIENT",
        clientId: clientId,
        requestId: requestId,
      }, location.origin);

      // Safety timeout — extension can take 30-60s for the full LinkedIn + X
      // capture + scrape, so we give it 120s.
      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        if (requestIdRef.current === requestId && loading) {
          setLoading(false);
          setTopLevelError("Extension didn't respond in 2 minutes — try the extension popup directly or use the Phantombuster fallback.");
          resolve();
        }
      }, 120_000);
    });
  }

  async function handleSyncViaPhantombuster() {
    setLoading(true);
    setResults(null);
    setSummary(null);
    setTopLevelError(null);
    setShowResults(true);

    try {
      const res = await fetch("/api/cron/phantombuster-sync");
      setLoading(false);
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setTopLevelError(`Phantombuster returned HTTP ${res.status} — try the Chrome extension popup instead.`);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data || !data.success) {
        setTopLevelError(data?.error || "Phantombuster sync failed.");
        return;
      }
      setResults(data?.data?.results || []);
    } catch (e) {
      setLoading(false);
      setTopLevelError(e instanceof Error ? e.message : "Network error");
    }
  }

  const hasExtension = extensionChecked && !!extensionVersion;

  return (
    <div className="relative inline-block">
      <div className="flex items-center gap-2">
        <button
          onClick={hasExtension ? handleSyncViaExtension : undefined}
          disabled={loading || !extensionChecked || !hasExtension}
          title={
            hasExtension
              ? "Drive the GershonAI extension to scrape this client's LinkedIn + X in your browser"
              : "Install the GershonAI Chrome extension to enable this"
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Chrome size={14} />}
          {loading ? "Scraping in your browser…" : hasExtension ? "Sync via extension" : extensionChecked ? "Install extension to sync" : "Detecting extension…"}
        </button>
      </div>

      {showResults && (loading || results || summary || topLevelError) && (
        <div className="absolute right-0 top-full mt-2 z-30 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              {loading
                ? hasExtension ? "Scraping in your browser…" : "Launching Phantombuster…"
                : "Sync results"}
            </span>
            {!loading && (
              <button onClick={() => setShowResults(false)} className="text-xs text-gray-400 hover:text-gray-600">
                Close
              </button>
            )}
          </div>
          {hasExtension && (
            <div className="px-4 py-2 text-[11px] text-gray-500 bg-blue-50 border-b border-blue-100">
              <Info size={11} className="inline mr-1 text-blue-500" />
              Using GershonAI extension v{extensionVersion} — opens LinkedIn + X in your browser and scrapes only this client.
            </div>
          )}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {loading && (
              <div className="px-4 py-6 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                {hasExtension
                  ? "Opening LinkedIn + X tabs and capturing cookies…"
                  : "Running the LinkedIn + Twitter phantoms in Phantombuster…"}
              </div>
            )}
            {topLevelError && !loading && (
              <div className="px-4 py-3 text-xs text-red-700 bg-red-50">
                <AlertTriangle size={12} className="inline mr-1" />
                {topLevelError}
              </div>
            )}
            {summary && !loading && (
              <div className="px-4 py-3 text-xs">
                <div className="font-medium text-gray-900 mb-1.5 flex items-center gap-1">
                  <CheckCircle2 size={14} className="text-green-600" />
                  {summary.totalUpserted ?? 0} post{summary.totalUpserted === 1 ? "" : "s"} upserted across {summary.accountCount ?? 0} account{summary.accountCount === 1 ? "" : "s"}
                </div>
                {(summary.totalFailed ?? 0) > 0 && (
                  <div className="text-red-700">{summary.totalFailed} failed</div>
                )}
                {(summary.ingestErrors || []).length > 0 && (
                  <ul className="text-amber-700 mt-1 space-y-0.5">
                    {summary.ingestErrors!.map((line, idx) => (
                      <li key={idx} className="flex gap-1">
                        <span aria-hidden>·</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {results?.map((r) => (
              <div key={r.platform} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900">{PLATFORM_LABELS[r.platform] ?? r.platform}</span>
                  {r.error ? <AlertTriangle size={14} className="text-red-500" /> : <CheckCircle2 size={14} className="text-green-500" />}
                </div>
                {r.error
                  ? <div className="text-red-700">{r.error}</div>
                  : <div className="text-gray-600">{r.postsUpserted} post{r.postsUpserted === 1 ? "" : "s"} upserted{r.rowsParsed != null ? ` (${r.rowsParsed} rows)` : ""}</div>
                }
              </div>
            ))}
          </div>
          {!loading && (summary?.totalUpserted ?? 0) > 0 && (
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
