"use client";

/**
 * /publishing — the content board (v4.37.0; replaces HeroPost + the
 * CloudCampaign review loop).
 *
 * Write a post once for LinkedIn and X → send it to the client → the client
 * comments / asks for changes / approves on their private review link → the
 * approved post is scheduled and goes out on both networks at the same time,
 * from the browser signed in to them. Each column is one step.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { CalendarDays, Check, Loader2, MessageSquare, Plus, Send, Users } from "lucide-react";
import {
  act, Counter, fmt, ItemBadge, liLength, LiveStrip, mediaSrc, NET_LABEL, NetChip, nets, PicturePicker, prepareImage, uploadImage, xLength, SuggestXButton, ReviewBadge,
  type ClientLite, type Item, type LiveAll, type Net, type Prepared,
} from "@/components/publishing/shared";
import { ItemPanel } from "@/components/publishing/item-panel";
import { InventoryPanel } from "@/components/publishing/inventory-panel";
import { AutopilotStrip } from "@/components/publishing/autopilot-panel";

type Limits = { x: number; linkedin: number; images: number; requireImage: boolean };
type Feed = { items: Item[]; clients: ClientLite[]; live: LiveAll; limits: Limits; canWrite: boolean };

const COLUMNS: { key: string; label: string; hint: string; match: (i: Item) => boolean }[] = [
  { key: "draft", label: "Drafts", hint: "Being written", match: (i) => i.status === "DRAFT" },
  { key: "review", label: "With client", hint: "Waiting for the client", match: (i) => i.status === "IN_REVIEW" },
  { key: "changes", label: "Changes requested", hint: "Back to the copywriter", match: (i) => i.status === "CHANGES_REQUESTED" },
  { key: "approved", label: "Approved", hint: "Ready to schedule", match: (i) => i.status === "APPROVED" },
  { key: "scheduled", label: "Scheduled", hint: "Goes out automatically", match: (i) => i.status === "SCHEDULED" },
  { key: "published", label: "Published", hint: "Last 60 days", match: (i) => i.status === "PUBLISHED" },
  { key: "problems", label: "Needs attention", hint: "Failed or partly published", match: (i) => i.status === "FAILED" || i.status === "PARTIAL" },
];

export function PublishingContentClient() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [batching, setBatching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setRefreshKey((k) => k + 1);
    try {
      const r = await fetch("/api/publishing/content", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setFeed(j.data);
      else setErr(j?.error || "Could not load.");
    } catch {
      setErr("Could not load.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    try {
      const id = new URLSearchParams(location.search).get("item");
      if (id) setOpenId(id);
    } catch {}
  }, []);

  const clientName = useMemo(() => new Map((feed?.clients || []).map((c) => [c.id, c.name])), [feed]);
  const items = (feed?.items || []).filter((i) => !clientFilter || i.clientId === clientFilter);
  const cutoff = Date.now() - 60 * 86400000;

  return (
    <div>
      <Header
        title="Publishing"
        eyebrow="Publishing"
        subtitle="Write once for LinkedIn and X, get the client's approval, and publish on both at the same time."
        actions={
          <>
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white">
              <option value="">All clients</option>
              {(feed?.clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Link href="/publishing/calendar" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              <CalendarDays size={14} /> Calendar
            </Link>
            <Link href="/publishing/accounts" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
              <Users size={14} /> Accounts &amp; review links
            </Link>
            {feed?.canWrite && (
              <button onClick={() => setBatching(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">
                <Send size={14} /> Send for review
              </button>
            )}
            {feed?.canWrite && (
              <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800">
                <Plus size={14} /> New post
              </button>
            )}
          </>
        }
      />

      <LiveStrip live={feed?.live ?? null} />
      <AutopilotStrip />
      <InventoryPanel refreshKey={refreshKey} onPick={setClientFilter} active={clientFilter} />
      {err && <div className="text-sm rounded-lg px-3 py-2 mb-4 bg-red-50 text-red-800">{err}</div>}

      {composing && feed && (
        <Composer
          clients={feed.clients}
          limits={feed.limits}
          defaultClient={clientFilter}
          onDone={(id) => { setComposing(false); void load(); if (id) setOpenId(id); }}
          onCancel={() => setComposing(false)}
        />
      )}

      {batching && feed && (
        <BatchSender
          items={feed.items}
          clients={feed.clients}
          requireImage={feed.limits.requireImage}
          defaultClient={clientFilter}
          onDone={() => { void load(); }}
          onClose={() => setBatching(false)}
        />
      )}

      {loading ? (
        <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const list = items.filter(col.match).filter((i) => col.key !== "published" || new Date(i.updatedAt).getTime() > cutoff);
            return (
              <div key={col.key} className="w-[260px] shrink-0">
                <div className="flex items-baseline justify-between px-1 mb-2">
                  <div className="text-sm font-semibold text-gray-900">{col.label}</div>
                  <span className={`text-[11px] px-1.5 rounded-full ${col.key === "problems" && list.length ? "bg-red-600 text-white" : col.key === "changes" && list.length ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600"}`}>{list.length}</span>
                </div>
                <div className="text-[11px] text-gray-500 px-1 mb-2">{col.hint}</div>
                <div className="space-y-2 min-h-[80px] bg-gray-50/70 rounded-xl p-2">
                  {list.map((i) => (
                    <button key={i.id} onClick={() => setOpenId(i.id)} className="w-full text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-gray-400 transition-colors">
                      <div className="flex items-center gap-1.5 mb-1">
                        {nets(i.platforms).map((n) => <NetChip key={n} n={n} />)}
                        <span className="text-[11px] font-medium text-gray-700 truncate">{i.clientId ? clientName.get(i.clientId) : "No client"}</span>
                      </div>
                      {i.media && i.media[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaSrc(i.media[0])} alt="" loading="lazy" className="w-full h-24 object-cover rounded-md mb-1.5 bg-gray-100" />
                      )}
                      {["IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED"].includes(i.status) && (
                        <div className="mb-1.5"><ReviewBadge status={i.status} clientFeedback={i.clientFeedback} big /></div>
                      )}
                      {i.title && <div className="text-xs font-semibold text-gray-900 truncate">{i.title}</div>}
                      <div className="text-xs text-gray-700 line-clamp-3 whitespace-pre-wrap break-words">{i.text}</div>
                      <div className="flex items-center gap-2 mt-2 text-[10.5px] text-gray-500">
                        {col.key === "problems" && <ItemBadge s={i.status} />}
                        {i.scheduledAt && <span>{fmt(i.scheduledAt)}</span>}
                        {(i.status === "IN_REVIEW" || i.status === "CHANGES_REQUESTED") && (() => {
                          const d = Math.floor((Date.now() - new Date(i.status === "IN_REVIEW" ? i.submittedAt || i.updatedAt : i.updatedAt).getTime()) / 86400000);
                          const late = i.status === "IN_REVIEW" ? d >= 2 : d >= 1;
                          return <span className={late ? "text-orange-700 font-medium" : ""}>{d === 0 ? "today" : `${d}d waiting`}</span>;
                        })()}
                        {(i._count?.comments ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={10} />{i._count?.comments}</span>}
                        {(i.media?.length ?? 0) === 0 && feed?.limits.requireImage && <span className="text-orange-600">no picture</span>}
                        <span className="ml-auto">v{i.version}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openId && feed && (
        <ItemPanel id={openId} clients={feed.clients} limits={feed.limits} canWrite={feed.canWrite} onClose={() => setOpenId(null)} onChanged={load} />
      )}
    </div>
  );
}

function Composer({
  clients, limits, defaultClient, onDone, onCancel,
}: {
  clients: ClientLite[];
  limits: Limits;
  defaultClient: string;
  onDone: (id: string | null) => void;
  onCancel: () => void;
}) {
  const [clientId, setClientId] = useState(defaultClient);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [textX, setTextX] = useState("");
  const [platforms, setPlatforms] = useState<Net[]>(["LINKEDIN", "TWITTER"]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pics, setPics] = useState<Prepared[]>([]);
  const [preparing, setPreparing] = useState(false);
  const xText = textX.trim() || text;
  const needPic = limits.requireImage && pics.length === 0;

  async function addFiles(files: File[]) {
    setErr(null);
    setPreparing(true);
    // One picture per post: a new pick replaces the current one.
    const f = files[0];
    if (f) {
      try { setPics([await prepareImage(f)]); } catch (e) { setErr(e instanceof Error ? e.message : "Could not read the picture."); }
    }
    setPreparing(false);
  }
  const tooLong =
    (platforms.includes("LINKEDIN") && liLength(text) > limits.linkedin) || (platforms.includes("TWITTER") && xLength(xText) > limits.x);

  async function save(mode: "draft" | "submit" | "approve") {
    setBusy(true);
    setErr(null);
    try {
      // Saved as a draft first, pictures attached, then sent / approved — so
      // the server checks the post with its pictures.
      const r = await fetch("/api/publishing/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientId || null, title, text, textX, platforms }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not save.");
      const id: string = j.data.id;
      for (const p of pics) {
        const e = await uploadImage(id, p);
        if (e) throw new Error(`Saved as a draft, but a picture failed: ${e}`);
      }
      if (mode !== "draft") {
        const e = await act(id, mode === "submit" ? "submit" : "approve");
        if (e) throw new Error(`Saved as a draft: ${e}`);
      }
      onDone(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="grid md:grid-cols-3 gap-2 mb-2">
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
          <option value="">— Company —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Internal title (optional)" className="text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
        <div className="flex items-center gap-3 text-sm">
          {(["LINKEDIN", "TWITTER"] as Net[]).map((n) => (
            <label key={n} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={platforms.includes(n)} onChange={(e) => setPlatforms((p) => (e.target.checked ? [...p, n].sort() : p.filter((x) => x !== n)) as Net[])} />
              <NetChip n={n} /> {NET_LABEL[n]}
            </label>
          ))}
        </div>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="The post…" className="w-full text-sm border border-gray-300 rounded-lg p-3" />
      <div className="flex gap-3 mb-2">
        {platforms.includes("LINKEDIN") && <Counter n={liLength(text)} max={limits.linkedin} label="LinkedIn" />}
        {platforms.includes("TWITTER") && <Counter n={xLength(xText)} max={limits.x} label="X" />}
      </div>
      {platforms.includes("TWITTER") && (
        <>
          <div className="text-[11px] font-medium text-gray-600 mb-1 flex items-center justify-between gap-2">
            <span>X version {xLength(text) > limits.x ? <span className="text-red-600">(needed — the post is too long for X)</span> : "(optional — the post above is used if empty)"}</span>
            <SuggestXButton text={text} onSuggest={setTextX} />
          </div>
          <textarea value={textX} onChange={(e) => setTextX(e.target.value)} rows={3} className="w-full text-sm border border-gray-300 rounded-lg p-2" />
        </>
      )}
      <div className="mt-3">
        <div className="text-[11px] font-medium text-gray-600 mb-1">
          Picture — one per post, the same on LinkedIn and X{limits.requireImage ? " · required" : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          {pics.map((p) => (
            <div key={p.preview} className="relative w-24 h-24">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="w-24 h-24 object-cover rounded-lg border border-gray-200" />
              <button onClick={() => setPics((all) => all.filter((x) => x !== p))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 text-white text-xs leading-5" aria-label="Remove">×</button>
            </div>
          ))}
          <PicturePicker onFiles={addFiles} disabled={busy || preparing} replace={pics.length > 0} />
          {preparing && <Loader2 size={14} className="animate-spin text-gray-400 self-center" />}
        </div>
      </div>
      {err && <div className="text-sm rounded-lg px-3 py-2 my-2 bg-red-50 text-red-800">{err}</div>}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button disabled={busy || preparing || !text.trim() || !platforms.length} onClick={() => save("draft")} className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50">
          Save draft
        </button>
        <button disabled={busy || preparing || !text.trim() || !clientId || tooLong || needPic || !platforms.length} onClick={() => save("submit")} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-violet-600 rounded-lg disabled:opacity-50" title={!clientId ? "Pick the client first" : needPic ? "Add a picture first" : ""}>
          <Send size={14} /> Send to client for review
        </button>
        <button disabled={busy || preparing || !text.trim() || tooLong || needPic || !platforms.length} onClick={() => save("approve")} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-sky-800 bg-sky-50 border border-sky-200 rounded-lg disabled:opacity-50">
          <Check size={14} /> Approve internally
        </button>
        <button onClick={onCancel} className="text-sm text-gray-500 underline ml-auto">Cancel</button>
        {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>
    </section>
  );
}


/**
 * Send several posts of one company for review in ONE batch (v4.41.0),
 * CloudCampaign-style: one email, one review page listing them all.
 */
function BatchSender({
  items, clients, requireImage, defaultClient, onDone, onClose,
}: {
  items: Item[]; clients: ClientLite[]; requireImage: boolean; defaultClient: string; onDone: () => void; onClose: () => void;
}) {
  const ready = (i: Item) => i.status === "DRAFT" || i.status === "CHANGES_REQUESTED";
  const withDrafts = clients.filter((c) => items.some((i) => i.clientId === c.id && ready(i)));
  const [clientId, setClientId] = useState(withDrafts.some((c) => c.id === defaultClient) ? defaultClient : withDrafts[0]?.id || "");
  const drafts = items.filter((i) => i.clientId === clientId && ready(i));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const month = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
  const clientLabel = clients.find((c) => c.id === clientId)?.name || "";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setPicked(new Set(items.filter((i) => i.clientId === clientId && ready(i)).map((i) => i.id)));
    setName(clientLabel ? `${clientLabel} — ${month}` : "");
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/publishing/review-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ids: Array.from(picked), name }),
      });
      const j = await r.json().catch(() => null);
      if (!j?.success) setResult(j?.error || `HTTP ${r.status}`);
      else {
        const d = j.data as { sent: string[]; skipped: { title: string; reason: string }[]; emailed: boolean; batch: string };
        setResult(
          `Sent ${d.sent.length} post${d.sent.length === 1 ? "" : "s"} as “${d.batch}”. ` +
            (d.emailed ? "The reviewer was emailed." : "No reviewer email is set for this company — add it in Accounts & review links.") +
            (d.skipped.length ? ` Not sent: ${d.skipped.map((s) => `${s.title} (${s.reason})`).join("; ")}` : ""),
        );
        onDone();
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : "failed");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-semibold text-gray-900 mb-1">Send for review in one batch</div>
        <p className="text-xs text-gray-500 mb-4">The reviewer gets one email and one page with every post below. They can approve each post or all of them at once.</p>
        {withDrafts.length === 0 ? (
          <p className="text-sm text-gray-600">No drafts waiting to be sent.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
                {withDrafts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Batch name" className="text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5 mb-3">
              {drafts.map((i) => {
                const noPic = requireImage && (i.media?.length ?? 0) === 0;
                return (
                  <label key={i.id} className="flex items-start gap-2 text-sm border border-gray-200 rounded-lg p-2">
                    <input
                      type="checkbox"
                      checked={picked.has(i.id)}
                      onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })}
                      className="mt-1"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-gray-900 truncate">{i.title || i.text.split("\n")[0]}</span>
                      <span className="block text-[11px] text-gray-500">
                        {i.status === "CHANGES_REQUESTED" ? "Revised after changes · " : ""}{i.scheduledAt ? fmt(i.scheduledAt) : "no date yet"}
                        {noPic && <span className="text-orange-600"> · no picture — will be skipped</span>}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
        {result && <div className="text-sm rounded-lg px-3 py-2 mb-3 bg-gray-50 text-gray-800">{result}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg">Close</button>
          {withDrafts.length > 0 && (
            <button disabled={busy || picked.size === 0} onClick={send} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send {picked.size} for review
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
