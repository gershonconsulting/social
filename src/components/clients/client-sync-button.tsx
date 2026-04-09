"use client";

import { useState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";

export function ClientSyncButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setMessage(null);

    const since = new Date();
    since.setDate(since.getDate() - 7);

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

    setLoading(false);
    const data = await res.json();

    if (data.success) {
      setMessage("Sync complete. Refresh to see updated data.");
    } else {
      setMessage(`Sync failed: ${data.error}`);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message && (
        <span className="text-xs text-gray-500">{message}</span>
      )}
      <button
        onClick={handleSync}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {loading ? "Syncing…" : "Sync Now"}
      </button>
    </div>
  );
}
