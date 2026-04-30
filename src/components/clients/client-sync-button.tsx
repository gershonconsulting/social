"use client";

import { useState } from "react";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Users, Heart } from "lucide-react";

interface PlatformResult {
  platform: string;
  externalAccountName: string | null;
  postsUpserted: number;
  followerCount: number | null;
  success: boolean;
  error: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
};

export function ClientSyncButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PlatformResult[] | null>(null);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);

  async function handleSync() {
    setLoading(true);
    setResults(null);
    setTopLevelError(null);
    setShowResults(true);

    const since = new Date();
    since.setDate(since.getDate() - 7);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "backfill",
          clientId,
          since: since.toISOString(),
          until: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (data.success && data.data?.perPlatform) {
        setResults(data.data.perPlatform as PlatformResult[]);
      } else if (data.error) {
        setTopLevelError(data.error);
      } else {
        setTopLevelError("Sync did not return a per-platform breakdown.");
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
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {loading ? "Syncing all platforms…" : "Sync Now"}
      </button>

      {showResults && (loading || results || topLevelError) && (
        <div className="absolute right-0 top-full mt-2 z-30 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              {loading ? "Pulling latest…" : "Sync results"}
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
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {loading && (
              <div className="px-4 py-6 flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin" />
                Pulling posts + follower counts from every platform…
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
                    {r.externalAccountName && (
                      <span className="text-gray-400 font-normal ml-1.5">· {r.externalAccountName}</span>
                    )}
                  </span>
                  {r.success ? (
                    <CheckCircle2 size={14} className="text-green-500" />
                  ) : (
                    <AlertTriangle size={14} className="text-red-500" />
                  )}
                </div>
                {r.success ? (
                  <div className="flex items-center gap-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw size={11} className="text-gray-400" />
                      {r.postsUpserted} new post{r.postsUpserted !== 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={11} className="text-gray-400" />
                      {r.followerCount !== null ? `${r.followerCount.toLocaleString()} followers` : "followers — n/a"}
                    </span>
                  </div>
                ) : (
                  <div className="text-red-700">{r.error || "Failed"}</div>
                )}
              </div>
            ))}
            {results && results.length === 0 && !topLevelError && (
              <div className="px-4 py-6 text-center text-xs text-gray-400">
                No platform connections to sync.
              </div>
            )}
          </div>
          {!loading && results && results.some((r) => r.success) && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Reload to see fresh data on this page</span>
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
