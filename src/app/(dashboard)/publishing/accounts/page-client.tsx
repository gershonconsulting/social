"use client";

/**
 * /publishing/accounts — "Connections" (v4.63.0; was "Accounts & review links").
 *
 * One answer per company and network: can a post go out right now, and from
 * which Chrome — or exactly what is missing. The Chromes with the extension
 * say which X accounts and LinkedIn pages they can publish to; nothing else
 * has to be set up. Where posts go, the reviewer and the review link are
 * under "Edit" on each company. The optional official-API connection lives
 * at the bottom, folded away.
 */

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Check, ChevronDown, ChevronRight, Copy, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { NetChip } from "@/components/publishing/shared";
import { LinkedAccountsCard } from "@/components/settings/linked-accounts-card";

type Conn = { platform: "LINKEDIN" | "TWITTER"; target: string; level: "ok" | "checking" | "missing" | "offline"; browsers: string[]; message: string };
type BrowserRow = {
  id: string; label: string; version: string | null; lastSeenAt: string; online: boolean;
  x: string[]; xSignedIn: boolean; linkedinSignedIn: boolean; linkedinName: string | null; linkedinPages: string[];
  lastPostAt: string | null; lastError: string | null;
};
const LATEST_EXT = "0.25.0";
function older(a: string | null, b: string): boolean {
  if (!a) return true;
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0); }
  return false;
}
function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
const TONE: Record<Conn["level"], { dot: string; text: string; word: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-emerald-800", word: "Ready" },
  checking: { dot: "bg-amber-400", text: "text-amber-800", word: "Checking" },
  offline: { dot: "bg-orange-500", text: "text-orange-800", word: "Offline" },
  missing: { dot: "bg-red-600", text: "text-red-800", word: "Not connected" },
};

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
  connections?: Conn[];
};

export function PublishingAccountsClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [browsers, setBrowsers] = useState<BrowserRow[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showApi, setShowApi] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/publishing/accounts", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) { setRows(j.data.accounts); setCanWrite(j.data.canWrite); setBrowsers(j.data.browsers || []); setErr(null); }
      else setErr(j?.error || "Could not load.");
    } catch { setErr("Could not load."); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const conns = (rows || []).flatMap((r) => r.connections || []);
  const ready = conns.filter((c) => c.level === "ok").length;
  const missing = conns.filter((c) => c.level !== "ok").length;

  return (
    <div>
      <Header
        title="Connections"
        eyebrow="Publishing"
        subtitle="Can each company's posts go out on LinkedIn and X right now — and if not, exactly what to fix. Posts are published by the Chrome that is signed in to that account, through the Social extension."
        actions={
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />
      {err && <div className="text-sm rounded-lg px-3 py-2 mb-4 bg-red-50 text-red-800">{err}</div>}

      <PublishingChromes browsers={browsers} />

      {rows && conns.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
          <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {ready} ready</span>
          {missing > 0 && <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-600" /> {missing} need attention</span>}
        </div>
      )}

      {!rows ? (
        !err && <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No campaign or internal companies yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => <AccountRow key={r.id} r={r} canWrite={canWrite} onSaved={(n) => setRows((all) => (all || []).map((x) => (x.id === n.id ? n : x)))} />)}
        </div>
      )}

      <div className="mt-8 border-t border-gray-200 pt-4">
        <button onClick={() => setShowApi((v) => !v)} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          {showApi ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Advanced — publish through LinkedIn's and X's official APIs instead (optional, not needed)
        </button>
        {showApi && <div className="mt-3"><LinkedAccountsCard /></div>}
      </div>
    </div>
  );
}

/** The Chromes that publish: which X accounts and LinkedIn pages each can post to. */
function PublishingChromes({ browsers }: { browsers: BrowserRow[] }) {
  const online = browsers.filter((b) => b.online);
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="text-sm font-semibold text-gray-900">Publishing Chromes</div>
        <div className="text-xs text-gray-500">{online.length} online · each one posts only for the accounts it is signed in to</div>
      </div>
      {browsers.length === 0 ? (
        <p className="text-sm text-gray-600">No Chrome has introduced itself yet. A Chrome with the Social extension {LATEST_EXT} or later appears here within 5 minutes of being opened.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {browsers.map((b) => (
            <div key={b.id} className="py-2 flex flex-wrap items-start gap-x-4 gap-y-1 text-sm">
              <div className="flex items-center gap-2 min-w-[220px]">
                <span className={`w-2 h-2 rounded-full ${b.online ? "bg-emerald-500" : "bg-gray-300"}`} />
                <span className="font-medium text-gray-900">{b.label}</span>
                <span className={`text-[11px] ${older(b.version, LATEST_EXT) ? "text-red-600 font-medium" : "text-gray-400"}`}>v{b.version || "?"}</span>
              </div>
              <div className="flex items-center gap-1.5 text-gray-700"><NetChip n="TWITTER" /> {b.xSignedIn ? (b.x.length ? b.x.map((h) => "@" + h).join(", ") : "signed in") : <span className="text-red-700">signed out</span>}</div>
              <div className="flex items-center gap-1.5 text-gray-700"><NetChip n="LINKEDIN" /> {b.linkedinSignedIn ? `${b.linkedinName || "signed in"}${b.linkedinPages.length ? ` · can post on ${b.linkedinPages.length} page${b.linkedinPages.length === 1 ? "" : "s"}` : ""}` : <span className="text-red-700">signed out</span>}</div>
              <div className="text-xs text-gray-400 ml-auto">{b.online ? "online" : `last seen ${ago(b.lastSeenAt)}`}{b.lastPostAt ? ` · last post ${ago(b.lastPostAt)}` : ""}</div>
            </div>
          ))}
        </div>
      )}
    </section>
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

  const [open, setOpen] = useState(false);
  const input = "w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 disabled:bg-gray-50";
  const conns = r.connections || [];
  const bad = conns.some((c) => c.level !== "ok");
  return (
    <div className={`bg-white rounded-xl border p-4 ${bad ? "border-red-200" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="text-sm font-semibold text-gray-900">{r.name}</div>
        <span className="text-[10px] uppercase tracking-wide text-gray-500">{r.clientType.toLowerCase()}</span>
        {r.pending > 0 && <span className="text-[11px] px-2 rounded-full bg-violet-50 text-violet-700">{r.pending} with the client</span>}
        <button onClick={() => setOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Edit where posts go, reviewer &amp; review link
        </button>
      </div>
      {r.route === "client" ? (
        <div className="text-sm text-gray-700">Published by {r.name}&apos;s own Chrome extension — {r.client?.live.overall.label.replace(/the publishing browser/g, `${r.name}'s browser`)}</div>
      ) : conns.length === 0 ? (
        <div className="text-sm text-red-800 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-600" /> No LinkedIn page or X account set — press Edit and add them.</div>
      ) : (
        <div className="space-y-1.5">
          {conns.map((c) => (
            <div key={c.platform + c.target} className="flex items-start gap-2 text-sm">
              <NetChip n={c.platform} />
              <span className="font-medium text-gray-800 min-w-[180px] truncate">{c.platform === "TWITTER" ? "@" + c.target.replace(/^@/, "") : c.target.replace(/^https?:\/\/(www\.)?linkedin\.com\//, "").replace(/\/$/, "")}</span>
              <span className={`inline-flex items-center gap-1.5 shrink-0 ${TONE[c.level].text}`}><span className={`w-2 h-2 rounded-full ${TONE[c.level].dot}`} />{TONE[c.level].word}</span>
              <span className="text-gray-600 text-[13px]">{c.message}</span>
            </div>
          ))}
        </div>
      )}
      {open && (<div className="mt-4 pt-3 border-t border-gray-100">
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
      </div>)}
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
