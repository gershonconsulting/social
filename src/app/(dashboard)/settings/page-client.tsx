"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { CheckCircle2, AlertCircle, XCircle, Download, RefreshCw, KeyRound, Eye, EyeOff, Loader2, Sparkles, ExternalLink } from "lucide-react";
import { CollectingSessionCard } from "@/components/settings/collecting-session-card";
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

      <AICard />

      <PhantombusterCard />

      <StreakCard />

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

function StreakCard() {
  const [configured, setConfigured] = useState(false);
  const [masked, setMasked] = useState<string | null>(null);
  const [pipelineKey, setPipelineKey] = useState("");
  const [stageKeys, setStageKeys] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [pipelines, setPipelines] = useState<
    Array<{ pipelineKey: string; name: string; stages: Array<{ stageKey: string; name: string }> }>
  >([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/settings/streak", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.success && j.data) {
          setConfigured(!!j.data.configured);
          setMasked(j.data.apiKeyMasked ?? null);
          setPipelineKey(j.data.pipelineKey ?? "");
          setStageKeys(j.data.currentStageKeys ?? "");
          setUpdatedAt(j.data.updatedAt ?? null);
        }
      }
    } catch {}
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newKey && newKey.length < 10) {
      setMsg({ kind: "err", text: "API key looks too short." });
      return;
    }
    if (!configured && !newKey) {
      setMsg({ kind: "err", text: "Paste your Streak API key to save." });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/settings/streak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: newKey.trim() || undefined,
          pipelineKey: pipelineKey.trim() || null,
          currentStageKeys: stageKeys.trim(),
        }),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok || !j?.success) {
        setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      } else {
        setMsg({ kind: "ok", text: "Saved." });
        setNewKey("");
        await load();
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  // Discover pipelines + stages so the user can copy the right keys.
  // Save the pasted key first if it isn't stored yet.
  async function discover() {
    setDiscovering(true);
    setMsg(null);
    setPipelines([]);
    try {
      if (newKey && !configured) {
        await fetch("/api/settings/streak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: newKey.trim() }),
        });
        setNewKey("");
        await load();
      }
      const r = await fetch("/api/admin/streak-sync?discover=1", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setMsg({ kind: "err", text: j?.error || `HTTP ${r.status}` });
      } else {
        setPipelines(j.data.pipelines ?? []);
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setDiscovering(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/streak-sync", { method: "POST" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setSyncResult(`Sync failed: ${j?.error || "HTTP " + r.status}`);
      } else {
        const d = j.data;
        const stale = (d.staleInDb || []).length;
        setSyncResult(
          `Fetched ${d.fetched} · created ${d.created} · linked ${d.linked} · updated ${d.updated}` +
            (d.errors ? ` · ${d.errors} errors` : "") +
            (stale ? ` · ${stale} no longer current (review)` : ""),
        );
      }
    } catch (e) {
      setSyncResult(e instanceof Error ? e.message : "Network error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <KeyRound size={18} className="text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">Streak CRM — client list source</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Pulls current clients from your Streak &ldquo;Clients&rdquo; pipeline into this app.
            Get the key in Gmail → Streak icon → Integrations.
            {configured && masked && (
              <> Current key: <code className="bg-gray-100 px-1 rounded">{masked}</code></>
            )}
            {updatedAt && <> · updated {relTime(updatedAt)}</>}
          </div>
        </div>
      </div>

      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-700 block mb-1">
            Streak API key {configured ? <span className="text-gray-400">(paste a new value to rotate)</span> : null}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={configured ? "(paste a new key to replace)" : "paste Streak API key…"}
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
            <label className="text-xs font-medium text-gray-700 block mb-1">Client pipeline key</label>
            <input
              type="text"
              value={pipelineKey}
              onChange={(e) => setPipelineKey(e.target.value)}
              placeholder="use Discover to find this"
              className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">
              Current stage keys <span className="text-gray-400">(comma-sep; blank = all)</span>
            </label>
            <input
              type="text"
              value={stageKeys}
              onChange={(e) => setStageKeys(e.target.value)}
              placeholder="e.g. 5001,5003"
              className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg font-mono"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
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
            onClick={discover}
            disabled={discovering || (!configured && !newKey)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg disabled:opacity-60"
            title="List Streak pipelines and stages so you can copy the right keys"
          >
            {discovering ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Discover pipelines
          </button>
          <button
            type="button"
            onClick={syncNow}
            disabled={!configured || syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 bg-white hover:bg-gray-50 rounded-lg disabled:opacity-60"
            title="Pull current clients from Streak now"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Sync clients now
          </button>
        </div>

        {msg && (
          <div className={"text-xs px-3 py-2 rounded " + (msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>
            {msg.text}
          </div>
        )}
        {syncResult && (
          <div className="text-xs px-3 py-2 rounded bg-gray-50 text-gray-700 font-mono whitespace-pre-wrap">
            {syncResult}
          </div>
        )}

        {pipelines.length > 0 && (
          <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-700 border-b border-gray-100">
              Pipelines — copy the client pipeline key + its current stage key(s) into the fields above
            </div>
            <div className="divide-y divide-gray-100">
              {pipelines.map((p) => (
                <div key={p.pipelineKey} className="px-3 py-2">
                  <div className="text-xs">
                    <strong className="text-gray-900">{p.name}</strong>{" "}
                    <code className="bg-gray-100 px-1 rounded text-[10px]">{p.pipelineKey}</code>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {p.stages.map((s) => (
                      <span key={s.stageKey} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-700">
                        {s.name || "(unnamed)"} <code className="text-gray-400">{s.stageKey}</code>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}


// ─── Content Intelligence (AI) ───────────────────────────────────────────────
// Keys live in the `settings` table rather than env vars so they can be rotated
// from this page without a redeploy — the deploy PAT can't touch
// .github/workflows anyway. ANTHROPIC_API_KEY / OPENAI_API_KEY env vars still
// work as a fallback if either is ever set on the Pages project.
//
// Two vendors are supported. With one key saved the engines just use it; the
// Active-provider row only decides the tie when both are configured.

type AIVendor = "anthropic" | "openai";

const VENDOR_META: Record<
  AIVendor,
  {
    label: string;
    endpoint: string;
    placeholder: string;
    defaultModel: string;
    /** Deep link straight to the vendor's API-keys page — one click, no hunting through the console. */
    keysUrl: string;
    where: string;
    envVar: string;
  }
> = {
  anthropic: {
    label: "Anthropic (Claude)",
    endpoint: "/api/settings/anthropic",
    placeholder: "sk-ant-api03-…",
    defaultModel: "claude-sonnet-4-5",
    keysUrl: "https://console.anthropic.com/settings/keys",
    where: "console.anthropic.com → Settings → API keys",
    envVar: "ANTHROPIC_API_KEY",
  },
  openai: {
    label: "OpenAI (GPT)",
    endpoint: "/api/settings/openai",
    placeholder: "sk-…",
    defaultModel: "gpt-4o",
    keysUrl: "https://platform.openai.com/api-keys",
    where: "platform.openai.com → API keys",
    envVar: "OPENAI_API_KEY",
  },
};

function AICard() {
  const [active, setActive] = useState<AIVendor | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [configured, setConfigured] = useState<{ anthropic: boolean; openai: boolean }>({
    anthropic: false,
    openai: false,
  });
  const [switching, setSwitching] = useState(false);
  const [switchMsg, setSwitchMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  async function loadProvider() {
    try {
      const r = await fetch("/api/settings/ai-provider", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (j?.success && j.data) {
        setActive(j.data.active ?? null);
        setActiveModel(j.data.activeModel ?? null);
        setConfigured(j.data.configured ?? { anthropic: false, openai: false });
      }
    } catch {}
  }
  useEffect(() => {
    loadProvider();
  }, [reloadToken]);

  async function chooseProvider(provider: AIVendor) {
    setSwitching(true);
    setSwitchMsg(null);
    try {
      const r = await fetch("/api/settings/ai-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const j = await r.json().catch(() => ({} as { error?: string; message?: string }));
      if (!r.ok || !j?.success) setSwitchMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      else setSwitchMsg({ kind: "ok", text: j.message || "Saved." });
      await loadProvider();
    } catch (e) {
      setSwitchMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSwitching(false);
    }
  }

  const anyConfigured = configured.anthropic || configured.openai;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-[#FE1B04]" />
          <div>
            <div className="text-sm font-semibold text-gray-900">Content Intelligence (AI)</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Powers the Content Intelligence tab on every company page and Post Studio on campaign
              companies. Add a key from either vendor — one is enough.
            </div>
          </div>
        </div>
        <span
          className={
            "text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border " +
            (anyConfigured
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-amber-50 text-amber-700 border-amber-200")
          }
        >
          {anyConfigured ? "Configured" : "Not configured"}
        </span>
      </div>

      {/* Which vendor answers the call */}
      <div className="px-4 py-3 border-b border-gray-100 bg-white">
        <div className="text-xs font-medium text-gray-700 mb-2">Active provider</div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["anthropic", "openai"] as const).map((v) => {
            const isActive = active === v;
            const has = configured[v];
            return (
              <button
                key={v}
                type="button"
                onClick={() => chooseProvider(v)}
                disabled={switching || !has}
                title={has ? `Use ${VENDOR_META[v].label}` : "Save a key for this provider first"}
                className={
                  "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
                  (isActive
                    ? "bg-red-50 text-[#FE1B04] border-red-200"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")
                }
              >
                {isActive && "✓ "}
                {VENDOR_META[v].label}
              </button>
            );
          })}
          {switching && <Loader2 size={13} className="animate-spin text-gray-400" />}
        </div>
        <div className="text-[11px] text-gray-400 mt-2">
          {active
            ? `Analyses and prompts currently run on ${VENDOR_META[active].label}${activeModel ? ` · ${activeModel}` : ""}.`
            : "No key saved yet — the AI tabs will show a “not configured” banner until you add one below."}
        </div>
        {switchMsg && (
          <div className={"text-xs mt-1.5 " + (switchMsg.kind === "ok" ? "text-emerald-700" : "text-red-600")}>
            {switchMsg.text}
          </div>
        )}
      </div>

      <AIKeyForm vendor="openai" onChanged={() => setReloadToken((n) => n + 1)} />
      <AIKeyForm vendor="anthropic" onChanged={() => setReloadToken((n) => n + 1)} />
    </div>
  );
}

/** One vendor's key + model, saved only after the vendor itself accepts the key. */
function AIKeyForm({ vendor, onChanged }: { vendor: AIVendor; onChanged: () => void }) {
  const meta = VENDOR_META[vendor];

  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<string>("none");
  const [masked, setMasked] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; display_name?: string }>>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    try {
      const r = await fetch(meta.endpoint, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      if (j?.success && j.data) {
        setConfigured(!!j.data.configured);
        setSource(j.data.source ?? "none");
        setMasked(j.data.apiKeyMasked ?? null);
        setModel(j.data.model ?? "");
        setUpdatedAt(j.data.updatedAt ?? null);
      }
    } catch {}
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!configured && !newKey.trim()) {
      setMsg({ kind: "err", text: `Paste your ${meta.label} API key to save.` });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(meta.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: newKey.trim() || undefined, model: model.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({} as { error?: string; message?: string }));
      if (!r.ok || !j?.success) {
        setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      } else {
        setMsg({ kind: "ok", text: j.message || "Saved." });
        setNewKey("");
        await load();
        onChanged();
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function fetchModels() {
    setLoadingModels(true);
    setMsg(null);
    try {
      const r = await fetch(`${meta.endpoint}?models=1`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) {
        setMsg({ kind: "err", text: j?.error || `HTTP ${r.status}` });
      } else {
        setModels(j.data.models ?? []);
        if (!model && j.data.models?.length) setModel(j.data.models[0].id);
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setLoadingModels(false);
    }
  }

  async function removeKey() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(meta.endpoint, { method: "DELETE" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) setMsg({ kind: "err", text: j?.error || `HTTP ${r.status}` });
      else {
        setMsg({ kind: "ok", text: "Key removed." });
        setModels([]);
        await load();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="p-4 space-y-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-800">{meta.label}</div>
        <span
          className={
            "text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border " +
            (configured
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-gray-50 text-gray-500 border-gray-200")
          }
        >
          {configured ? "Key saved" : "No key"}
        </span>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">API key</label>
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={masked ? `Saved: ${masked} — paste a new key to replace` : meta.placeholder}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 pr-9"
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
        <div className="text-[11px] text-gray-400 mt-1">
          <a
            href={meta.keysUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-[#FE1B04] hover:underline inline-flex items-center gap-0.5"
          >
            Get a key from {meta.where}
            <ExternalLink size={10} />
          </a>{" "}
          — it is verified against {meta.label.split(" ")[0]} before it is saved.
          {source === "env" && ` Currently falling back to the ${meta.envVar} environment variable.`}
          {updatedAt && ` Last updated ${relTime(updatedAt)}.`}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
        <div className="flex gap-2">
          {models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name ? `${m.display_name} — ${m.id}` : m.id}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={meta.defaultModel}
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          )}
          <button
            type="button"
            onClick={fetchModels}
            disabled={loadingModels || !configured}
            className="px-3 py-2 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 inline-flex items-center gap-1.5"
            title={configured ? "Ask the provider which models this key can use" : "Save a key first"}
          >
            {loadingModels ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            List models
          </button>
        </div>
      </div>

      {msg && <div className={"text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-red-600")}>{msg.text}</div>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-sm font-medium text-white bg-[#FE1B04] rounded-lg hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          Save
        </button>
        {source === "settings" && (
          <button
            type="button"
            onClick={removeKey}
            disabled={busy}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
          >
            Remove key
          </button>
        )}
      </div>
    </form>
  );
}
