"use client";

/**
 * /knowledge-base (v4.51.0) — per company: Value Prop · Competitive Landscape ·
 * ICPs. Left: the Publishing companies, each opening its three sections.
 * Right: the section — editable, "Draft with Intelligence" fills or rewrites
 * it. The Competitive Landscape also shows, live, what the tracked
 * competitors are posting about (from the collected posts).
 * Autopilot reads all three before writing a post.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Building2, ChevronDown, ChevronRight, ClipboardPaste, FileUp, Loader2, Plus, Save, Sparkles, Swords, Target, Trash2, Wand2 } from "lucide-react";

type Source = "ai" | "manual";
type Icp = { id: string; name: string; description: string; source: Source; updatedAt: string; from?: string };
type KB = {
  valueProp: { text: string; source: Source; updatedAt: string | null };
  competitive: { notes: string; source: Source; updatedAt: string | null };
  icps: Icp[];
};
type Snapshot = {
  competitors: Array<{ id: string; name: string; posts: number; perWeek: number; topThemes: string[]; keywords: string[] }>;
  themes: Array<{ label: string; self: number; competitors: number }>;
  gaps: string[];
  owned: string[];
  topPosts: Array<{ company: string; date: string; text: string; engagement: number; url: string | null }>;
  linkedVia: string;
  windowDays: number;
} | null;
type Company = { id: string; name: string; clientType: string; hasValueProp: boolean; hasCompetitive: boolean; icps: { id: string; name: string }[] };
type View = "valueProp" | "competitive" | "icps";

function AiTag({ s }: { s: Source }) {
  return s === "ai" ? <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">AI draft</span> : null;
}

export function KnowledgeBaseClient() {
  const params = useSearchParams();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [open, setOpen] = useState<string>("");
  const [view, setView] = useState<View>("valueProp");
  const [kb, setKb] = useState<KB | null>(null);
  const [snap, setSnap] = useState<Snapshot>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // v4.59.0 audit: load errors are shown instead of an endless spinner.
  const [listErr, setListErr] = useState<string | null>(null);
  const [kbErr, setKbErr] = useState<string | null>(null);
  // v4.59.0 audit: the company whose KB was last requested — a slower response
  // for an earlier company must not show (or later be saved) under this one.
  const wanted = useRef("");

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/knowledge-base", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.error || `Could not load the companies (HTTP ${r.status}).`);
      setListErr(null);
      setCompanies(j.data.companies);
      setCanWrite(j.data.canWrite);
      setOpen((o) => o || params.get("c") || j.data.companies.find((c: Company) => /gershon/i.test(c.name))?.id || j.data.companies[0]?.id || "");
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Could not load the companies.");
    }
  }, [params]);
  useEffect(() => { void loadList(); }, [loadList]);

  const loadKb = useCallback(async (id: string) => {
    wanted.current = id;
    if (!id) return;
    setKb(null); setSnap(null); setMsg(null); setDirty(false); setKbErr(null);
    try {
      const r = await fetch(`/api/knowledge-base/${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (wanted.current !== id) return;
      if (!r.ok || !j?.success) throw new Error(j?.error || `Could not load this Knowledge Base (HTTP ${r.status}).`);
      setKb(j.data.kb); setSnap(j.data.snapshot);
    } catch (e) {
      if (wanted.current !== id) return;
      setKbErr(e instanceof Error ? e.message : "Could not load this Knowledge Base.");
    }
  }, []);
  useEffect(() => { void loadKb(open); }, [open, loadKb]);

  // v4.59.0 audit: switching company drops unsaved edits — ask first.
  function pick(id: string) {
    if (id === open) { setView("valueProp"); return; }
    if (dirty && !confirm("Discard unsaved edits?")) return;
    setOpen(id); setView("valueProp");
  }

  const current = useMemo(() => companies?.find((c) => c.id === open), [companies, open]);

  async function save() {
    if (!kb) return;
    setBusy("save"); setMsg(null);
    try {
      const id = open;
      const r = await fetch(`/api/knowledge-base/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kb) });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not save.");
      // v4.59.0 audit: don't paint this company's KB over another one opened meanwhile.
      if (wanted.current === id) { setKb(j.data.kb); setDirty(false); setMsg("Saved."); }
      void loadList();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy(null);
  }

  async function draft(section: View | "all") {
    if (dirty && !confirm("You have unsaved edits — Intelligence will replace this section. Continue?")) return;
    setBusy("draft:" + section); setMsg("Intelligence is drafting…");
    try {
      const id = open;
      const r = await fetch(`/api/knowledge-base/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section, overwrite: section !== "all" }) });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Intelligence failed.");
      // v4.59.0 audit: only show the draft if the same company is still open.
      if (wanted.current === id) { setKb(j.data.kb); setDirty(false); setMsg("Drafted — read it, edit what's wrong, and save."); }
      void loadList();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Intelligence failed."); }
    setBusy(null);
  }

  const edit = (f: (k: KB) => KB) => { setKb((k) => (k ? f(structuredClone(k)) : k)); setDirty(true); };

  return (
    <div>
      <Header
        title="Knowledge Base"
        eyebrow="Publishing"
        subtitle="What every campaign is built on: the company's value proposition, what its competitors post about, and the ICPs we target. Autopilot writes from it."
      />
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        <nav className="rounded-xl border border-gray-200 bg-white p-2 h-fit">
          {!companies && !listErr && <Loader2 className="animate-spin text-gray-400 m-3" />}
          {!companies && listErr && (
            <div className="m-2 text-sm text-red-700">
              {listErr} <button onClick={() => { setListErr(null); void loadList(); }} className="underline ml-1">Retry</button>
            </div>
          )}
          {companies && companies.length === 0 && (
            <p className="m-2 text-sm text-gray-500">No campaign or internal companies yet.</p>
          )}
          {companies?.map((c) => {
            const isOpen = c.id === open;
            return (
              <div key={c.id} className="mb-1">
                <button onClick={() => pick(c.id)} className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm ${isOpen ? "font-semibold text-gray-900" : "text-gray-700 hover:bg-gray-50"}`}>
                  <Building2 size={15} className="shrink-0" />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-[10px] text-gray-400">{c.clientType === "INTERNAL" ? "internal" : "campaign"}</span>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {isOpen && (
                  <div className="ml-4 border-l border-gray-200 pl-2 space-y-0.5">
                    {([
                      ["valueProp", Sparkles, "Value Prop", c.hasValueProp],
                      ["competitive", Swords, "Competitive Landscape", c.hasCompetitive],
                      ["icps", Target, `ICPs (${c.icps.length})`, c.icps.length > 0],
                    ] as const).map(([v, Icon, label, filled]) => (
                      <button key={v} onClick={() => setView(v)} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${view === v ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
                        <Icon size={14} /> {label}
                        {!filled && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-500" title="Empty" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <section className="rounded-xl border border-gray-200 bg-white p-5 min-h-[420px]">
          {/* v4.59.0 audit: spinner only while something is actually loading. */}
          {!kb && kbErr && (
            <p className="text-sm text-red-700">
              {kbErr} <button onClick={() => void loadKb(open)} className="underline ml-1">Retry</button>
            </p>
          )}
          {!kb && !kbErr && companies && companies.length === 0 && (
            <p className="text-sm text-gray-500">Nothing to show — there is no company with publishing yet.</p>
          )}
          {!kb && !kbErr && !listErr && !(companies && companies.length === 0) && <Loader2 className="animate-spin text-gray-400" />}
          {kb && current && (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  {current.name} — {view === "valueProp" ? "Value Prop" : view === "competitive" ? "Competitive Landscape" : "ICPs"}
                </h2>
                {view === "valueProp" && <AiTag s={kb.valueProp.source} />}
                {view === "competitive" && <AiTag s={kb.competitive.source} />}
                {canWrite && (
                  <div className="ml-auto flex gap-2">
                    <button disabled={!!busy} onClick={() => draft(view)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg disabled:opacity-50">
                      {busy === "draft:" + view ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Draft with Intelligence
                    </button>
                    <button disabled={!!busy || !dirty} onClick={save} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg disabled:opacity-40">
                      {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                    </button>
                  </div>
                )}
              </div>
              {msg && <p className="text-sm text-gray-600 mb-3">{msg}</p>}

              {view === "valueProp" && (
                <>
                  <p className="text-xs text-gray-500 mb-2">Positioning, who it is for, the problem, how it solves it, proof points, the promise. Every Autopilot post carries it.</p>
                  <textarea
                    value={kb.valueProp.text}
                    readOnly={!canWrite}
                    onChange={(e) => edit((k) => ({ ...k, valueProp: { ...k.valueProp, text: e.target.value } }))}
                    rows={16}
                    placeholder="Empty — press “Draft with Intelligence”."
                    className="w-full border border-gray-300 rounded-lg p-3 text-sm leading-relaxed"
                  />
                </>
              )}

              {view === "competitive" && (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs text-gray-500 mb-2">Positioning notes — how we answer competitors. Autopilot uses these plus the live data below.</p>
                    <textarea
                      value={kb.competitive.notes}
                      readOnly={!canWrite}
                      onChange={(e) => edit((k) => ({ ...k, competitive: { ...k.competitive, notes: e.target.value } }))}
                      rows={8}
                      placeholder="Empty — press “Draft with Intelligence”."
                      className="w-full border border-gray-300 rounded-lg p-3 text-sm leading-relaxed"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">What competitors are posting (last {snap?.windowDays ?? 90} days, live)</h3>
                    {!snap || !snap.competitors.length ? (
                      // v4.59.0 audit: the Competitor Watch tab only exists on INTERNAL companies.
                      <p className="text-sm text-amber-700">
                        {current.clientType === "INTERNAL"
                          ? <>No competitors linked to this company yet — add them in the company&apos;s Competitor Watch tab and their posts appear here.</>
                          : <>No competitors linked to this company yet. Competitors are tracked from an Internal company&apos;s Competitor Watch tab — ask Gershon to add this company&apos;s competitors and their posts appear here.</>}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        <table className="w-full text-sm">
                          <thead className="text-left text-gray-500"><tr><th className="py-1">Competitor</th><th>Posts / week</th><th>Talks about</th><th>Key words</th></tr></thead>
                          <tbody>
                            {snap.competitors.map((c) => (
                              <tr key={c.id} className="border-t border-gray-100 align-top">
                                <td className="py-1.5 font-medium">{c.name}</td>
                                <td>{c.perWeek}</td>
                                <td>{c.topThemes.join(", ") || "—"}</td>
                                <td className="text-gray-600">{c.keywords.slice(0, 6).join(", ")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {snap.gaps.length > 0 && <p className="text-sm"><b>Gaps to take</b> (they post about it, we don&apos;t): {snap.gaps.join(", ")}</p>}
                        {snap.owned.length > 0 && <p className="text-sm"><b>Our own ground:</b> {snap.owned.join(", ")}</p>}
                        {snap.topPosts.length > 0 && (
                          <div>
                            <div className="text-sm font-semibold mb-1">Their best posts</div>
                            {snap.topPosts.map((p, i) => (
                              <blockquote key={i} className="border-l-2 border-gray-200 pl-3 my-2 text-sm text-gray-700">
                                <div className="text-xs text-gray-500">{p.company} · {p.date} · {p.engagement} engagement {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="underline ml-1">open</a>}</div>
                                {p.text}
                              </blockquote>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {view === "icps" && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">Each Autopilot post is written for one ICP, in rotation.</p>
                  {canWrite && <IcpUpload clientId={open} dirty={dirty} onDone={(k, n, from) => { setKb(k); setDirty(false); setMsg(`${n} ICP${n === 1 ? "" : "s"} added from “${from}”.`); void loadList(); }} />}
                  {!kb.icps.length && <p className="text-sm text-amber-700">No ICP yet — press “Draft with Intelligence” or add one.</p>}
                  {kb.icps.map((icp, idx) => (
                    <div key={icp.id || idx} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Target size={14} className="text-gray-500" />
                        <input
                          value={icp.name}
                          readOnly={!canWrite}
                          onChange={(e) => edit((k) => { k.icps[idx].name = e.target.value; return k; })}
                          className="flex-1 font-medium text-sm border-b border-transparent focus:border-gray-300 outline-none"
                        />
                        <AiTag s={icp.source} />
                        {icp.from && <span className="text-[11px] text-gray-500 truncate max-w-[200px]" title={icp.from}>from {icp.from}</span>}
                        {canWrite && <button onClick={() => edit((k) => { k.icps.splice(idx, 1); return k; })} className="text-gray-400 hover:text-red-600" title="Remove"><Trash2 size={14} /></button>}
                      </div>
                      <textarea
                        value={icp.description}
                        readOnly={!canWrite}
                        onChange={(e) => edit((k) => { k.icps[idx].description = e.target.value; return k; })}
                        rows={6}
                        className="w-full border border-gray-300 rounded-lg p-2 text-sm"
                      />
                    </div>
                  ))}
                  {canWrite && (
                    <button onClick={() => edit((k) => { k.icps.push({ id: "", name: "New ICP — <Job title> at <company type>", description: "Company:\nRole & seniority:\nPains:\nTriggers to buy now:\nWhat they need to hear from us:", source: "manual", updatedAt: new Date().toISOString() }); return k; })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg">
                      <Plus size={14} /> Add an ICP
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Upload a file or paste text → Intelligence adds the ICPs it finds (v4.53.0). */
function IcpUpload({ clientId, dirty, onDone }: { clientId: string; dirty: boolean; onDone: (kb: KB, added: number, from: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [docs, setDocs] = useState<Array<{ from: string; uploadedAt: string; chars: number }>>([]);
  useEffect(() => {
    void fetch(`/api/knowledge-base/${clientId}/icp-upload`, { cache: "no-store" }).then((r) => r.json()).then((j) => j?.success && setDocs(j.data.docs)).catch(() => {});
  }, [clientId]);

  async function send(body: FormData | string) {
    if (dirty && !confirm("You have unsaved edits — they will be lost. Continue?")) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/knowledge-base/${clientId}/icp-upload`, typeof body === "string"
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body, name: "Pasted text" }) }
        : { method: "POST", body });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not read it.");
      setDocs(j.data.docs); setPaste(null);
      onDone(j.data.kb, j.data.added, j.data.from);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not read it."); }
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-800">Upload ICP information</span>
        <span className="text-xs text-gray-500">PDF, Word, Excel, CSV or text — Intelligence adds the ICPs it finds.</span>
        <label className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} Upload a file
          <input type="file" className="hidden" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.pptx,.odt" onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            const fd = new FormData(); fd.append("file", f); void send(fd);
          }} />
        </label>
        <button disabled={busy} onClick={() => setPaste(paste === null ? "" : null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white"><ClipboardPaste size={14} /> Paste text</button>
      </div>
      {paste !== null && (
        <div className="mt-2">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder="Paste the ICP brief, persona descriptions, target list criteria…" className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
          <button disabled={busy || paste.trim().length < 40} onClick={() => void send(paste)} className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Find the ICPs
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {docs.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">Uploaded: {docs.slice(0, 5).map((d) => `${d.from} (${new Date(d.uploadedAt).toLocaleDateString()})`).join(" · ")}</p>
      )}
    </div>
  );
}
