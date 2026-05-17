"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { CheckCircle2, AlertCircle, XCircle, Download, RefreshCw } from "lucide-react";

interface Probe {
  hasCookies: boolean;
  capturedAt: string | null;
  cookieNames: string[];
  testResult: "ok" | "fail" | "untested";
  testStatus?: number;
  testMessage?: string;
  identifiedAs?: string | null;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
}

export function SettingsPageClient() {
  const [li, setLi] = useState<Probe | null>(null);
  const [tw, setTw] = useState<Probe | null>(null);
  const [extLatest, setExtLatest] = useState<string>("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/cookies/verify", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.success) {
          setLi(j.data.LINKEDIN ?? null);
          setTw(j.data.TWITTER ?? null);
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

  function row(label: string, accent: string, p: Probe | null) {
    if (!p || !p.hasCookies) {
      return (
        <div className="px-4 py-4 border-b border-gray-100 last:border-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900">{label}</div>
              <div className="text-xs text-amber-700 mt-0.5">No session captured yet — open GershonAI → Sync Now.</div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
              <AlertCircle size={12} /> Needed
            </span>
          </div>
        </div>
      );
    }
    const badge =
      p.testResult === "ok"
        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full"><CheckCircle2 size={12} /> Validated</span>
        : p.testResult === "fail"
        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-full" title={p.testMessage || ""}><XCircle size={12} /> Test failed</span>
        : <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">Stored</span>;
    return (
      <div className="px-4 py-4 border-b border-gray-100 last:border-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-gray-900">
              {label}
              {p.identifiedAs && <span className="ml-2 text-xs text-gray-500">logged in as <strong>{p.identifiedAs}</strong></span>}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Captured {relTime(p.capturedAt)}</div>
          </div>
          {badge}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {p.cookieNames.map((n) => (
            <span key={n} className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-700">{n}</span>
          ))}
        </div>
        {p.testResult === "fail" && p.testMessage && (
          <div className="text-[11px] text-red-700 mt-2 leading-relaxed">
            <strong>Note:</strong> {p.testMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <Header
        title="Settings"
        subtitle="GershonAI Chrome extension status — sessions are captured locally and sent here for server-side scraping."
        actions={
          <button onClick={refresh} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Re-test
          </button>
        }
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="text-sm font-semibold text-gray-900">Captured sessions + live validation</div>
          <div className="text-xs text-gray-500 mt-0.5">
            <strong>Validated</strong> means the server made an authenticated test call with the cookie and it returned the matching account.{" "}
            <strong>Test failed</strong> usually means the cookie is fine but LinkedIn/X rejected the call because it came from a Cloudflare datacenter IP — the cookie still works when used from your laptop.
          </div>
        </div>
        {row("LinkedIn", "#0A66C2", li)}
        {row("X / Twitter", "#000", tw)}
      </div>

      <ChangePasswordCard />

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start gap-3 mb-3">
          <Download size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-gray-900">GershonAI Chrome extension</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Latest published: <strong>v{extLatest || "…"}</strong>
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-600 leading-relaxed space-y-2">
          <p>
            Folder:{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded">
              C:\Users\oatti\Documents\Claude\Projects\Social Gershon Consulting\watchman-chrome-extension
            </code>
          </p>
          <p>
            <code className="bg-gray-100 px-1 rounded">chrome://extensions/</code> → Developer mode →
            <strong> Load unpacked</strong> (first time) or click <strong>reload</strong> on the GershonAI card (subsequent updates).
          </p>
        </div>
      </div>
    </div>
  );
}
