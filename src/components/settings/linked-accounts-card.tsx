"use client";

/**
 * Settings → Linked accounts (v4.60.0) — step 1 of publishing onboarding,
 * like CloudCampaign: each company's LinkedIn and X are connected by their
 * owner through LinkedIn's / X's own login, then posts go out from the app
 * through the official APIs with an exact link to every post.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";

type App = { clientId: string | null; hasSecret: boolean; source: string; ready: boolean; redirectUri: string };
type Li = {
  expiresAt: string; refreshExpiresAt: string | null; connectedBy: string | null; connectedAt: string;
  authors: { urn: string; name: string; kind: "organization" | "person" }[]; author: string | null; lastError: string | null; postsHere: boolean;
};
type X = { username: string; name: string | null; expiresAt: string; connectedBy: string | null; connectedAt: string; lastError: string | null; postsHere: boolean };
type Company = { id: string; name: string; clientType: string; target: { linkedinUrl: string | null; xHandle: string | null }; linkedin: Li | null; x: X | null };
type Data = { apps: { linkedin: App; x: App }; companies: Company[]; canWrite: boolean };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export function LinkedAccountsCard() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showApps, setShowApps] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/publishing/linked", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setD(j.data);
      else setErr(j?.error || "Could not load.");
    } catch { setErr("Could not load."); }
  }, []);

  useEffect(() => {
    void load();
    try {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get("linked_error")) setErr(sp.get("linked_error"));
      if (sp.get("linked")) setNote(`${sp.get("linked") === "x" ? "X" : "LinkedIn"} connected.`);
    } catch {}
  }, [load]);

  useEffect(() => {
    if (d && d.apps && (!d.apps.linkedin.ready || !d.apps.x.ready)) setShowApps(true);
  }, [d]);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/publishing/linked", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!j?.success) setErr(j?.error || "Failed.");
    await load();
    setBusy(false);
  }

  const connect = (net: "linkedin" | "x", clientId: string) => { window.location.href = `/api/publishing/oauth/${net}/start?clientId=${encodeURIComponent(clientId)}`; };

  return (
    <div id="linked" className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-start gap-3">
        <Link2 size={18} className="text-red-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">Linked accounts — publishing onboarding</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Step 1 for every company that publishes: the owner of the LinkedIn page and of the X account connects it here, on LinkedIn&apos;s / X&apos;s own login.
            Posts then go out from social.gershon.ai with a direct link to each post. Companies not connected keep publishing through the Chrome extension.
          </div>
        </div>
      </div>

      {err && <div className="px-4 py-2 text-sm bg-red-50 text-red-800 border-b border-red-100">{err}</div>}
      {note && <div className="px-4 py-2 text-sm bg-emerald-50 text-emerald-800 border-b border-emerald-100">{note}</div>}
      {!d && !err && <div className="p-4"><Loader2 className="animate-spin text-gray-400" size={16} /></div>}

      {d && (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr className="border-b border-gray-100">
                <th className="px-4 py-2">Company</th><th className="py-2">LinkedIn</th><th className="py-2 pr-4">X</th>
              </tr>
            </thead>
            <tbody>
              {d.companies.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.name}</div>
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">{c.clientType === "CAMPAIGN" ? "Campaign" : "Internal"}</div>
                  </td>
                  <td className="py-3 pr-3">
                    {c.linkedin ? (
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium"><CheckCircle2 size={14} /> Connected{c.linkedin.connectedBy ? ` by ${c.linkedin.connectedBy}` : ""}</div>
                        <div className="text-xs text-gray-600">
                          Post as{" "}
                          <select
                            disabled={!d.canWrite || busy}
                            value={c.linkedin.author || ""}
                            onChange={(e) => post({ clientId: c.id, action: "author", urn: e.target.value })}
                            className="text-xs border border-gray-300 rounded px-1 py-0.5"
                          >
                            {c.linkedin.authors.map((a) => <option key={a.urn} value={a.urn}>{a.name}{a.kind === "person" ? "" : " (page)"}</option>)}
                          </select>
                        </div>
                        <div className="text-[11px] text-gray-500">Expiring {day(c.linkedin.refreshExpiresAt || c.linkedin.expiresAt)}</div>
                        {!c.linkedin.postsHere && (
                          <div className="text-[11px] text-amber-700 inline-flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5" /> Posts go to {c.target.linkedinUrl || "no page"} — not this connection (extension used).</div>
                        )}
                        {c.linkedin.lastError && <div className="text-[11px] text-red-700">{c.linkedin.lastError}</div>}
                        {d.canWrite && (
                          <div className="flex gap-3 text-xs">
                            <button onClick={() => connect("linkedin", c.id)} className="inline-flex items-center gap-1 text-gray-700 underline"><RefreshCw size={11} /> Refresh credentials</button>
                            <button onClick={() => confirm(`Disconnect LinkedIn for ${c.name}?`) && post({ clientId: c.id, net: "linkedin", action: "disconnect" })} className="inline-flex items-center gap-1 text-red-700 underline"><Unlink size={11} /> Disconnect</button>
                          </div>
                        )}
                      </div>
                    ) : d.canWrite ? (
                      <button disabled={!d.apps.linkedin.ready} onClick={() => connect("linkedin", c.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-40" style={{ background: "#0A66C2" }}>
                        <Link2 size={12} /> Connect LinkedIn
                      </button>
                    ) : <span className="text-xs text-gray-400">Not connected</span>}
                  </td>
                  <td className="py-3 pr-4">
                    {c.x ? (
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium"><CheckCircle2 size={14} /> @{c.x.username}</div>
                        {!c.x.postsHere && (
                          <div className="text-[11px] text-amber-700 inline-flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5" /> Posts go to {c.target.xHandle ? "@" + c.target.xHandle : "no account"} — not this one (extension used).</div>
                        )}
                        {c.x.lastError && <div className="text-[11px] text-red-700">{c.x.lastError}</div>}
                        {d.canWrite && (
                          <div className="flex gap-3 text-xs">
                            <button onClick={() => connect("x", c.id)} className="inline-flex items-center gap-1 text-gray-700 underline"><RefreshCw size={11} /> Reconnect</button>
                            <button onClick={() => confirm(`Disconnect X for ${c.name}?`) && post({ clientId: c.id, net: "x", action: "disconnect" })} className="inline-flex items-center gap-1 text-red-700 underline"><Unlink size={11} /> Disconnect</button>
                          </div>
                        )}
                      </div>
                    ) : d.canWrite ? (
                      <button disabled={!d.apps.x.ready} onClick={() => connect("x", c.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-black rounded-lg disabled:opacity-40">
                        <Link2 size={12} /> Connect X
                      </button>
                    ) : <span className="text-xs text-gray-400">Not connected</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-4 py-3">
            <button onClick={() => setShowApps((s) => !s)} className="text-xs font-medium text-gray-700 inline-flex items-center gap-1">
              {showApps ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Publishing apps (one-time setup)
              {(!d.apps.linkedin.ready || !d.apps.x.ready) && <span className="ml-1 text-amber-700">— needed before Connect works</span>}
            </button>
            {showApps && (
              <div className="grid md:grid-cols-2 gap-4 mt-3">
                <AppForm net="linkedin" label="LinkedIn — “Gershon Social Publisher”" app={d.apps.linkedin} canWrite={d.canWrite} onSaved={load}
                  help="LinkedIn Developers → the app → Auth: Client ID and Primary Client Secret. Add the redirect URL below under “Authorized redirect URLs”. Needs the Community Management API." />
                <AppForm net="x" label="X — developer app" app={d.apps.x} canWrite={d.canWrite} onSaved={load}
                  help="developer.x.com → Projects & Apps → the app → User authentication: OAuth 2.0, type “Web App”, permissions Read and write. Add the redirect URL below as Callback URI. Keys and tokens → OAuth 2.0 Client ID and Client Secret." />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AppForm({ net, label, app, canWrite, onSaved, help }: { net: "linkedin" | "x"; label: string; app: App; canWrite: boolean; onSaved: () => void; help: string }) {
  const [id, setId] = useState(app.clientId || "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/publishing/linked", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ net, clientId: id, clientSecret: secret || null }) });
    const j = await r.json().catch(() => null);
    setMsg(j?.success ? "Saved." : j?.error || "Failed.");
    if (j?.success) { setSecret(""); onSaved(); }
    setBusy(false);
  }
  return (
    <div className="border border-gray-200 rounded-lg p-3 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-gray-900">{label}</div>
        {app.ready ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={12} /> Ready</span> : <span className="text-amber-700">Not ready</span>}
      </div>
      <p className="text-gray-500">{help}</p>
      <div>
        <div className="text-gray-600 mb-0.5">Redirect URL</div>
        <div className="flex items-center gap-1">
          <code className="bg-gray-100 px-1.5 py-0.5 rounded truncate">{app.redirectUri}</code>
          <button onClick={() => { try { void navigator.clipboard.writeText(app.redirectUri); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }} className="text-gray-600"><Copy size={12} /></button>
          {copied && <span className="text-emerald-700">Copied</span>}
        </div>
      </div>
      {canWrite && (
        <>
          <label className="block">Client ID
            <input value={id} onChange={(e) => setId(e.target.value)} className="block w-full mt-0.5 border border-gray-300 rounded px-2 py-1 font-mono" />
          </label>
          <label className="block">Client Secret {app.hasSecret && <span className="text-gray-400">(saved — leave empty to keep)</span>}
            <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} className="block w-full mt-0.5 border border-gray-300 rounded px-2 py-1 font-mono" />
          </label>
          <div className="flex items-center gap-2">
            <button disabled={busy || !id.trim()} onClick={save} className="px-3 py-1 rounded-lg bg-gray-900 text-white disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
            {msg && <span className="text-gray-600">{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
