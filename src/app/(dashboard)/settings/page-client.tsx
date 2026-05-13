"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { CheckCircle2, AlertCircle, Download, RefreshCw } from "lucide-react";

interface CookieStatus {
  capturedAt: string;
  cookieCount: number;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

export function SettingsPageClient() {
  const [linkedinStatus, setLinkedinStatus] = useState<CookieStatus | null>(null);
  const [twitterStatus, setTwitterStatus] = useState<CookieStatus | null>(null);
  const [extLatest, setExtLatest] = useState<string>("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/cookies/save", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.success) {
          setLinkedinStatus(j.data.LINKEDIN ?? null);
          setTwitterStatus(j.data.TWITTER ?? null);
        }
      }
    } catch {}
    try {
      const v = await fetch("/api/extension/version", { cache: "no-store" });
      if (v.ok) {
        const j = await v.json();
        if (j?.success) setExtLatest(j.data.latest);
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  function statusRow(label: string, status: CookieStatus | null, color: string) {
    return (
      <div className="flex items-center justify-between py-3 px-4 border-b border-gray-100 last:border-0">
        <div>
          <div className="text-sm font-medium text-gray-900">{label}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {status
              ? <>Captured {relTime(status.capturedAt)} · {status.cookieCount} cookies on file</>
              : <span className="text-amber-700">No session captured yet — click Sync Now in the Chrome extension.</span>}
          </div>
        </div>
        {status
          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full"><CheckCircle2 size={12} /> Active</span>
          : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full"><AlertCircle size={12} /> Needed</span>}
      </div>
    );
  }

  return (
    <div>
      <Header
        title="Settings"
        subtitle="Watchman Chrome extension status — sessions are captured locally and sent here for server-side scraping."
        actions={
          <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh status
          </button>
        }
      />

      {/* Captured sessions */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="text-sm font-semibold text-gray-900">Captured sessions</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Click the Watchman icon in Chrome → <strong>Sync Now</strong>. Both platforms refresh in one click.
          </div>
        </div>
        {statusRow("LinkedIn", linkedinStatus, "#0A66C2")}
        {statusRow("X / Twitter", twitterStatus, "#000")}
      </div>

      {/* Chrome extension card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start gap-3 mb-3">
          <Download size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-gray-900">Watchman Chrome extension</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Latest published: <strong>v{extLatest || "…"}</strong>
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-600 leading-relaxed space-y-2">
          <p>
            The extension folder lives at:{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded">
              C:\Users\oatti\Documents\Claude\Projects\Social Gershon Consulting\watchman-chrome-extension
            </code>
          </p>
          <p>
            To install or update: open <code className="bg-gray-100 px-1 rounded">chrome://extensions/</code> →
            Developer mode on → <strong>Load unpacked</strong> (first time) or click the <strong>reload</strong> icon on the Watchman card (subsequent updates).
          </p>
          <p className="text-gray-500">
            When I publish a new version of the extension, the popup will show an &quot;Update available&quot; banner the next time you open it.
          </p>
        </div>
      </div>
    </div>
  );
}
