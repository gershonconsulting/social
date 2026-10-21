"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { CheckCircle2, AlertCircle, XCircle, Download, RefreshCw, Loader2, Sparkles } from "lucide-react";
import { CollectingSessionCard } from "@/components/settings/collecting-session-card";
import { LinkedAccountsCard } from "@/components/settings/linked-accounts-card";
import { useCollectingMode } from "@/lib/collecting-mode";

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
  const [collecting] = useCollectingMode();
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
              <div className="text-xs text-amber-700 mt-0.5">
                {collecting
                  ? "No session captured yet — open GershonAI → Sync Now."
                  : "No session captured yet — capture it on the computer that runs the extension. This one is viewing only."}
              </div>
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

      <LinkedAccountsCard />

      <CollectingSessionCard />

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

      <CloudflareAICard />

      <ChangePasswordCard />

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start gap-3 mb-3">
          <Download size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-gray-900">GershonAI Chrome extension</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Latest published: <strong>v{extLatest || "…"}</strong>
              {!collecting && <> · not required on this computer</>}
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-600 leading-relaxed space-y-2">
          {/* v4.59.0 audit: was a hard-coded local Windows folder path. */}
          <p>
            Download, install and check the extension on the{" "}
            <Link href="/extension" className="text-red-600 underline hover:text-red-700">Extension page</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // v4.59.0 audit: nothing exposes "has a password" to the signed-in user, so a
  // LinkedIn-only account learns it from the API's specific error and the form
  // is replaced by a friendly note.
  const [noPassword, setNoPassword] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 12) {
      setMsg({ kind: "err", text: "New password must be at least 12 characters." });
      return;
    }
    if (next !== confirm) {
      setMsg({ kind: "err", text: "New password and confirmation do not match." });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) {
        setMsg({ kind: "ok", text: "Password updated. You will stay signed in for the rest of this session." });
        setCur(""); setNext(""); setConfirm("");
      } else if (typeof j?.error === "string" && j.error.includes("has no password")) {
        setNoPassword(true);
      } else {
        setMsg({ kind: "err", text: j?.error || ("Server returned " + r.status) });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  if (noPassword) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="text-sm font-semibold text-gray-900">Password</div>
        <div className="text-xs text-gray-500 mt-0.5">
          You sign in with LinkedIn, so there is no password to change here.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-3">
      <div>
        <div className="text-sm font-semibold text-gray-900">Change my password</div>
        <div className="text-xs text-gray-500 mt-0.5">
          The platform shipped with a weak default — set something stronger. Min 12 characters.
        </div>
      </div>
      <input type="password" autoComplete="current-password" required
        placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500" />
      <input type="password" autoComplete="new-password" required minLength={12}
        placeholder="New password (>= 12 chars)" value={next} onChange={(e) => setNext(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500" />
      <input type="password" autoComplete="new-password" required minLength={12}
        placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500" />
      <button type="submit" disabled={busy || !cur || !next || !confirm}
        className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? "Updating..." : "Update password"}
      </button>
      {msg && (
        <div className={"text-xs px-3 py-2 rounded " + (msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>
          {msg.text}
        </div>
      )}
    </form>
  );
}



// ─── Content Intelligence (AI) — Cloudflare Workers AI only ──────────────────
// Since v4.29.0 every AI feature runs on the Workers AI binding: no vendor key
// to paste. Phantombuster, Streak and the Anthropic/OpenAI key forms were
// removed from this page on 2026-10-13 at Olivier's request ("we don't need
// Phantombuster, Streak, or AI other than Cloudflare AI").

type AIStatus = { provider: string; model: string; available: boolean; ok: boolean; error: string | null; models: string[] };

function CloudflareAICard() {
  const [st, setSt] = useState<AIStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [model, setModelState] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/settings/ai-provider", { cache: "no-store" });
      const j = await r.json();
      if (j.success) { setSt(j.data); setModelState(j.data.model); }
      else setSt({ provider: "cloudflare", model: "", available: false, ok: false, error: j.error ?? "Could not read the AI status", models: [] });
    } catch (e) {
      setSt({ provider: "cloudflare", model: "", available: false, ok: false, error: e instanceof Error ? e.message : "Network error", models: [] });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/settings/ai-provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok && j.success !== false ? "Saved." : (j.error ?? "Could not save."));
      await load();
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start gap-3 mb-3">
        <Sparkles size={18} className="text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">Content Intelligence (AI) — Cloudflare Workers AI</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Every AI feature (Content Intelligence, post suggestions, competitor brief) runs on Cloudflare AI. No API key is needed.
          </div>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Test
        </button>
      </div>
      {loading && !st ? (
        <div className="text-xs text-gray-500 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking…</div>
      ) : st?.ok ? (
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full"><CheckCircle2 size={12} /> Working · {st.model}</div>
      ) : (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 inline-flex items-start gap-1.5">
          <XCircle size={12} className="mt-0.5 shrink-0" />
          <span>{st?.available === false ? "The Cloudflare AI binding is not available on this deployment." : "Cloudflare AI did not answer."}{st?.error ? " " + st.error : ""}</span>
        </div>
      )}
      {st && st.models.length > 0 && (
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-600">Model</label>
          <select value={model} onChange={(e) => setModelState(e.target.value)} className="text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
            {[...new Set([st.model, ...st.models])].filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={save} disabled={saving || model === st.model} className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-lg px-3 py-1.5">
            {saving ? "Saving…" : "Save model"}
          </button>
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
        </div>
      )}
    </div>
  );
}
