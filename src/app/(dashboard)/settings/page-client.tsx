"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { CheckCircle2, AlertCircle, XCircle, Download, RefreshCw, KeyRound, Eye, EyeOff, Loader2 } from "lucide-react";

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

      <PhantombusterCard />

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

function ChangePasswordCard() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

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
      } else {
        setMsg({ kind: "err", text: j?.error || ("Server returned " + r.status) });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
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


function PhantombusterCard() {
  const [configured, setConfigured] = useState(false);
  const [masked, setMasked] = useState<string | null>(null);
  const [twitterPhantomId, setTwitterPhantomId] = useState("");
  const [linkedinPhantomId, setLinkedinPhantomId] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/settings/phantombuster", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.success && j.data) {
          setConfigured(!!j.data.configured);
          setMasked(j.data.apiKeyMasked ?? null);
          setTwitterPhantomId(j.data.twitterPhantomId ?? "");
          setLinkedinPhantomId(j.data.linkedinPhantomId ?? "");
          setUpdatedAt(j.data.updatedAt ?? null);
        }
      }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newKey && newKey.length < 20) {
      setMsg({ kind: "err", text: "API key looks too short — expected 30+ chars from Phantombuster." });
      return;
    }
    setBusy(true);
    try {
      // POST overwrites; if the user didn't paste a fresh key, server requires
      // it as min 20 chars. So we only POST when newKey is supplied. For
      // phantom-ID-only updates we'd need a PATCH route — kept simple here:
      // if no newKey, we just no-op and tell the user.
      if (!newKey) {
        setMsg({ kind: "err", text: "Paste a fresh API key to save." });
        return;
      }
      const r = await fetch("/api/settings/phantombuster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: newKey.trim(),
          twitterPhantomId: twitterPhantomId.trim() || null,
          linkedinPhantomId: linkedinPhantomId.trim() || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as { error?: string }));
        setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      } else {
        setMsg({ kind: "ok", text: "Saved. Daily import will use the new credentials starting tomorrow." });
        setNewKey("");
        await load();
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function runImportNow() {
    setImporting(true);
    setImportResult(null);
    // Two requests — one per platform — so each stays inside the CF
    // worker budget. The single-call variant timed out on LinkedIn.
    const lines: string[] = [];
    for (const platform of ["TWITTER", "LINKEDIN"]) {
      try {
        const r = await fetch(`/api/cron/pb-import-latest?platform=${platform}`);
        const j = await r.json().catch(() => null);
        if (!j?.success) {
          lines.push(`${platform}: import failed (${j?.error || "HTTP " + r.status})`);
          continue;
        }
        const per = (j.data?.perPlatform || []) as Array<{ platform: string; postsUpserted: number; rowsParsed: number; clientsMatched: number; error?: string }>;
        for (const p of per) {
          if (p.error) lines.push(`${p.platform}: ${p.error}`);
          else lines.push(`${p.platform}: ${p.postsUpserted} posts upserted across ${p.clientsMatched} clients (${p.rowsParsed} rows parsed)`);
        }
      } catch (e) {
        lines.push(`${platform}: ${e instanceof Error ? e.message : "network error"}`);
      }
    }
    setImportResult(lines.join("\n"));
    setImporting(false);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <KeyRound size={18} className="text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">Phantombuster — backup data source</div>
          <div className="text-xs text-gray-500 mt-0.5">
            The daily 06:00 UTC cron imports the latest CSVs from these phantoms whenever the Chrome extension hasn&apos;t run.
            {configured && masked && (
              <> Current key: <code className="bg-gray-100 px-1 rounded">{masked}</code></>
            )}
            {updatedAt && (
              <> · updated {relTime(updatedAt)}</>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">
            API key {configured ? <span className="text-gray-400">(paste a new value to rotate; current is masked above)</span> : null}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={configured ? "(paste a new key to replace)" : "DFApuorw…"}
              className="w-full text-sm px-3 py-2 pr-9 border border-gray-300 rounded-lg font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Twitter / X phantom ID</label>
            <input
              type="text"
              value={twitterPhantomId}
              onChange={(e) => setTwitterPhantomId(e.target.value)}
              placeholder="3106895142569208"
              className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">LinkedIn phantom ID</label>
            <input
              type="text"
              value={linkedinPhantomId}
              onChange={(e) => setLinkedinPhantomId(e.target.value)}
              placeholder="607354820598909"
              className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg font-mono"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Save
          </button>
          <button
            type="button"
            onClick={runImportNow}
            disabled={!configured || importing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg disabled:opacity-60"
            title="Pull the latest CSVs from S3 and upsert posts right now"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Import latest CSV now
          </button>
        </div>

        {msg && (
          <div className={"text-xs px-3 py-2 rounded " + (msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>
            {msg.text}
          </div>
        )}
        {importResult && (
          <div className="text-xs px-3 py-2 rounded bg-gray-50 text-gray-700 font-mono whitespace-pre-wrap">
            {importResult}
          </div>
        )}
      </form>
    </div>
  );
}
