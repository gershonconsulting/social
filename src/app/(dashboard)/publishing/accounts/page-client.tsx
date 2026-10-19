"use client";

/**
 * /publishing/accounts — per client: which LinkedIn page and X account the
 * posts go to, who reviews them, and the client's private review link
 * (v4.37.0). Defaults come from the accounts already tracked for the company.
 */

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Check, Copy, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { NetChip } from "@/components/publishing/shared";

type Dest = { id: string; network: "LINKEDIN" | "TWITTER"; kind: "page" | "profile" | "group" | "company" | "personal"; target: string; enabled: boolean };
const KIND_LABEL: Record<Dest["kind"], string> = {
  page: "Company page", profile: "Personal profile", group: "Group", company: "Company account", personal: "Personal account",
};
function liKind(u: string): Dest["kind"] { return /\/groups\//.test(u) ? "group" : /\/in\//.test(u) ? "profile" : "page"; }

type Row = {
  id: string; name: string; clientType: string;
  xKind?: "company" | "personal"; destinations?: Dest[];
  xHandle: string | null; linkedinUrl: string | null; reviewerName: string | null; reviewerEmail: string | null;
  reviewUrl: string; pending: number;
  route: "workspace" | "client";
  client: { connectUrl: string; live: { overall: { level: string; label: string } }; lastSeenAt: string | null; version: string | null } | null;
};

export function PublishingAccountsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/publishing/accounts", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) { setRows(j.data.accounts); setCanWrite(j.data.canWrite); }
      else setErr(j?.error || "Could not load.");
    } catch { setErr("Could not load."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <Header
        title="Accounts & review links"
        eyebrow="Publishing"
        subtitle="Where each client's posts go, who approves them, and the private link they review on — no account needed. Rotating a link switches the old one off."
      />
      {err && <div className="text-sm rounded-lg px-3 py-2 mb-4 bg-red-50 text-red-800">{err}</div>}
      {!rows ? (
        <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No campaign, internal or client companies yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => <AccountRow key={r.id} r={r} canWrite={canWrite} onSaved={(n) => setRows((all) => (all || []).map((x) => (x.id === n.id ? n : x)))} />)}
        </div>
      )}
    </div>
  );
}

function AccountRow({ r, canWrite, onSaved }: { r: Row; canWrite: boolean; onSaved: (r: Row) => void }) {
  const [li, setLi] = useState(r.linkedinUrl || "");
  const [x, setX] = useState(r.xHandle ? "@" + r.xHandle : "");
  const [name, setName] = useState(r.reviewerName || "");
  const [email, setEmail] = useState(r.reviewerEmail || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [xKind, setXKind] = useState<"company" | "personal">(r.xKind || "company");
  const [dests, setDests] = useState<Dest[]>(r.destinations || []);
  const dirty = li !== (r.linkedinUrl || "") || x !== (r.xHandle ? "@" + r.xHandle : "") || name !== (r.reviewerName || "") || email !== (r.reviewerEmail || "")
    || xKind !== (r.xKind || "company") || JSON.stringify(dests) !== JSON.stringify(r.destinations || []);

  async function call(method: "PUT" | "POST", body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/publishing/accounts", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: r.id, ...body }) });
      const j = await res.json();
      if (!j?.success) throw new Error(j?.error || "Could not save.");
      const n: Row = j.data;
      onSaved(n);
      setLi(n.linkedinUrl || ""); setX(n.xHandle ? "@" + n.xHandle : ""); setName(n.reviewerName || ""); setEmail(n.reviewerEmail || "");
      setXKind(n.xKind || "company"); setDests(n.destinations || []);
      setMsg(method === "POST" ? "New link created — the old one no longer works." : "Saved.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy(false);
  }

  const input = "w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 disabled:bg-gray-50";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="text-sm font-semibold text-gray-900">{r.name}</div>
        <span className="text-[10px] uppercase tracking-wide text-gray-500">{r.clientType.toLowerCase()}</span>
        {r.pending > 0 && <span className="text-[11px] px-2 rounded-full bg-violet-50 text-violet-700">{r.pending} with the client</span>}
      </div>
      <div className="grid md:grid-cols-4 gap-2">
        <label className="block"><span className="text-[11px] text-gray-600 inline-flex items-center gap-1"><NetChip n="LINKEDIN" /> Main LinkedIn — page, profile or group{li ? ` (${KIND_LABEL[liKind(li)].toLowerCase()})` : ""}</span>
          <input disabled={!canWrite} value={li} onChange={(e) => setLi(e.target.value)} placeholder="linkedin.com/company/… · /in/… · /groups/…" className={input} /></label>
        <label className="block"><span className="text-[11px] text-gray-600 inline-flex items-center gap-1"><NetChip n="TWITTER" /> Main X account</span>
          <div className="flex gap-1">
            <input disabled={!canWrite} value={x} onChange={(e) => setX(e.target.value)} placeholder="@handle" className={input} />
            <select disabled={!canWrite} value={xKind} onChange={(e) => setXKind(e.target.value as "company" | "personal")} className="text-xs border border-gray-300 rounded-lg px-1">
              <option value="company">Company</option><option value="personal">Personal</option>
            </select>
          </div></label>
        <label className="block"><span className="text-[11px] text-gray-600">Client reviewer</span>
          <input disabled={!canWrite} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} /></label>
        <label className="block"><span className="text-[11px] text-gray-600">Reviewer email (gets each post to review)</span>
          <input disabled={!canWrite} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@client.com" className={input} /></label>
      </div>
      <Destinations dests={dests} setDests={setDests} canWrite={canWrite} input={input} />
      <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
        {canWrite && dirty && (
          <button disabled={busy} onClick={() => call("PUT", { linkedinUrl: li, xHandle: x, reviewerName: name, reviewerEmail: email, xKind, destinations: dests })} className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-white bg-gray-900 rounded-lg disabled:opacity-50">
            <Check size={12} /> Save
          </button>
        )}
        <span className="text-gray-500">Review link:</span>
        <code className="truncate max-w-[340px] text-gray-700">{r.reviewUrl}</code>
        <button onClick={() => { try { void navigator.clipboard.writeText(r.reviewUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }} className="inline-flex items-center gap-1 underline text-gray-700">
          <Copy size={11} /> {copied ? "Copied" : "Copy"}
        </button>
        {canWrite && (
          <button disabled={busy} onClick={() => { if (confirm("Create a new review link? The current one stops working.")) void call("POST", { action: "rotate_link" }); }} className="inline-flex items-center gap-1 underline text-gray-500">
            <RefreshCw size={11} /> New link
          </button>
        )}
        {busy && <Loader2 size={12} className="animate-spin text-gray-400" />}
        {msg && <span className="text-gray-600">{msg}</span>}
      </div>
      <Route r={r} canWrite={canWrite} busy={busy} call={call} />
    </div>
  );
}

/** Who publishes this company's posts (v4.42.0). */
function Route({ r, canWrite, busy, call }: { r: Row; canWrite: boolean; busy: boolean; call: (m: "PUT" | "POST", b: Record<string, unknown>) => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const lv = r.client?.live.overall.level;
  const tone = lv === "live" ? "bg-emerald-600" : lv === "signed_out" ? "bg-orange-500" : "bg-red-600";
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-gray-700">Publishes through</span>
        {(["workspace", "client"] as const).map((v) => (
          <label key={v} className="inline-flex items-center gap-1 text-gray-700">
            <input
              type="radio"
              disabled={!canWrite || busy}
              checked={r.route === v}
              onChange={() => {
                if (v === "client" && !confirm(`${r.name}'s posts will be published ONLY by ${r.name}'s own Chrome extension, signed in to their LinkedIn and X. Gershon's browser stops publishing them. Continue?`)) return;
                void call("PUT", { route: v });
              }}
            />
            {v === "workspace" ? "Gershon's publishing browser" : `${r.name}'s own Chrome extension`}
          </label>
        ))}
      </div>
      {r.route === "client" && r.client && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-bold uppercase text-white px-1.5 py-0.5 rounded ${tone}`}>{lv === "live" ? "Connected" : lv === "signed_out" ? "Signed out" : lv === "offline" ? "Offline" : "Not connected yet"}</span>
            <span className="text-gray-600">{r.client.live.overall.label.replace(/the publishing browser/g, `${r.name}'s browser`)}</span>
            {r.client.version && <span className="text-gray-400">· extension {r.client.version}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600">Send this link to {r.name}. Opened in their Chrome, it installs and connects the extension:</span>
            <code className="truncate max-w-[340px] text-gray-700">{r.client.connectUrl}</code>
            <button onClick={() => { try { void navigator.clipboard.writeText(r.client!.connectUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }} className="inline-flex items-center gap-1 underline text-gray-700">
              <Copy size={11} /> {copied ? "Copied" : "Copy"}
            </button>
            {canWrite && (
              <button disabled={busy} onClick={() => { if (confirm(`Replace ${r.name}'s publishing key? Their extension stops until they open the new link.`)) void call("POST", { action: "rotate_key" }); }} className="inline-flex items-center gap-1 underline text-gray-500">
                <RefreshCw size={11} /> New key
              </button>
            )}
          </div>
          <div className="text-[11px] text-gray-500">The extension only receives {r.name}'s approved posts when they are due, and reports back here. It sees nothing else in this workspace.</div>
        </div>
      )}
    </div>
  );
}

/**
 * More places to post (v4.53.0): any mix of LinkedIn company page, personal
 * profile, group, X company account and X personal account. Every approved
 * post goes to the main accounts above AND to each ticked line here.
 */
function Destinations({ dests, setDests, canWrite, input }: { dests: Dest[]; setDests: (d: Dest[]) => void; canWrite: boolean; input: string }) {
  const add = (network: Dest["network"]) =>
    setDests([...dests, { id: Math.random().toString(36).slice(2, 10), network, kind: network === "TWITTER" ? "personal" : "profile", target: "", enabled: true }]);
  const upd = (i: number, patch: Partial<Dest>) => setDests(dests.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  return (
    <div className="mt-3">
      <div className="text-[11px] text-gray-600 mb-1">Also post to — each approved post goes to the main accounts above and to every ticked line:</div>
      <div className="space-y-1.5">
        {dests.map((d, i) => (
          <div key={d.id} className="flex items-center gap-2">
            <input type="checkbox" disabled={!canWrite} checked={d.enabled} onChange={(e) => upd(i, { enabled: e.target.checked })} />
            <NetChip n={d.network} />
            <input
              disabled={!canWrite}
              value={d.network === "TWITTER" && d.target && !d.target.startsWith("@") ? "@" + d.target : d.target}
              onChange={(e) => upd(i, { target: e.target.value, ...(d.network === "LINKEDIN" ? { kind: liKind(e.target.value) } : {}) })}
              placeholder={d.network === "TWITTER" ? "@handle" : "linkedin.com/company/… · /in/… · /groups/…"}
              className={input + " max-w-md"}
            />
            {d.network === "TWITTER" ? (
              <select disabled={!canWrite} value={d.kind} onChange={(e) => upd(i, { kind: e.target.value as Dest["kind"] })} className="text-xs border border-gray-300 rounded-lg px-1 py-1.5">
                <option value="company">Company account</option><option value="personal">Personal account</option>
              </select>
            ) : (
              <span className="text-[11px] text-gray-500 w-28">{d.target ? KIND_LABEL[d.kind] : ""}</span>
            )}
            {canWrite && <button onClick={() => setDests(dests.filter((_, k) => k !== i))} className="text-gray-400 hover:text-red-600" title="Remove"><Trash2 size={13} /></button>}
          </div>
        ))}
      </div>
      {canWrite && (
        <div className="flex gap-2 mt-1.5">
          <button onClick={() => add("LINKEDIN")} className="inline-flex items-center gap-1 text-xs text-gray-700 underline"><Plus size={11} /> LinkedIn page, profile or group</button>
          <button onClick={() => add("TWITTER")} className="inline-flex items-center gap-1 text-xs text-gray-700 underline"><Plus size={11} /> X account</button>
        </div>
      )}
    </div>
  );
}
