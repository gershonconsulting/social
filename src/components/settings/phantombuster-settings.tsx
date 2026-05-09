"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff } from "lucide-react";

interface PBState {
  configured: boolean;
  apiKeyMasked: string | null;
  twitterPhantomId: string | null;
  linkedinPhantomId: string | null;
  deleteAfterRun: boolean;
  updatedAt?: string;
}

export function PhantombusterSettings() {
  const [state, setState] = useState<PBState | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [twitterPhantomId, setTwitterPhantomId] = useState("");
  const [linkedinPhantomId, setLinkedinPhantomId] = useState("");
  const [deleteAfterRun, setDeleteAfterRun] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/phantombuster", { cache: "no-store" });
      const j = await r.json();
      if (j.success) {
        setState(j.data);
        setTwitterPhantomId(j.data.twitterPhantomId || "");
        setLinkedinPhantomId(j.data.linkedinPhantomId || "");
        setDeleteAfterRun(!!j.data.deleteAfterRun);
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings/phantombuster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          twitterPhantomId: twitterPhantomId.trim() || null,
          linkedinPhantomId: linkedinPhantomId.trim() || null,
          deleteAfterRun,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.success) {
        setMsg({ kind: "ok", text: j.message || "Saved." });
        setApiKey(""); // clear input field after save
        await load();
      } else {
        setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    }
    setSaving(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Phantombuster (data source)</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Phantombuster is the scraping engine that pulls posts from X / Twitter and LinkedIn.
          Save your API key + the Phantom IDs you want to use here.
        </p>
      </div>

      {loading && (
        <div className="px-6 py-6 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      )}

      {!loading && (
        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">API key</label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={state?.configured ? `Saved: ${state.apiKeyMasked} — paste a new key only if rotating` : "Paste your Phantombuster API key"}
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">
                phantombuster.com → Settings → Account → API key
              </div>
            </div>
            <div className="flex items-center md:col-span-1">
              <label className="text-xs text-gray-700 inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={deleteAfterRun}
                  onChange={(e) => setDeleteAfterRun(e.target.checked)}
                  className="rounded"
                />
                Delete phantom after each run (ephemeral mode — Olivier's pattern)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                X / Twitter Phantom ID
              </label>
              <input
                type="text"
                value={twitterPhantomId}
                onChange={(e) => setTwitterPhantomId(e.target.value)}
                placeholder="e.g. 3106895142569208 (Twitter Media Extractor)"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
              />
              <div className="text-[10px] text-gray-400 mt-1">
                Numeric ID from the URL of the Phantom page on phantombuster.com
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                LinkedIn Phantom ID
              </label>
              <input
                type="text"
                value={linkedinPhantomId}
                onChange={(e) => setLinkedinPhantomId(e.target.value)}
                placeholder="e.g. LinkedIn Activity Extractor ID"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
              />
              <div className="text-[10px] text-gray-400 mt-1">
                LinkedIn Activity / Company Posts Extractor Phantom ID
              </div>
            </div>
          </div>

          {msg && (
            <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${
              msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
            }`}>
              {msg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {msg.text}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              {state?.configured ? `Last saved: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "—"}` : "Not yet configured."}
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Saving…" : "Save Phantombuster settings"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
