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
import { CalendarDays, Check, ChevronDown, ChevronRight, Loader2, MessageSquare, Plus, Send, Users } from "lucide-react";
import {
  act, Counter, fmt, ItemBadge, liLength, LiveStrip, mediaSrc, NET_LABEL, NetChip, nets, PicturePicker, prepareImage, uploadImage, xLength, SuggestXButton, ReviewBadge,
  type ClientLite, type Item, type LiveAll, type Net, type Prepared,
} from "@/components/publishing/shared";
import { ItemPanel } from "@/components/publishing/item-panel";
import { InventoryPanel } from "@/components/publishing/inventory-panel";
import { AutopilotStrip } from "@/components/publishing/autopilot-panel";

type Limits = { x: number; linkedin: number; images: number; requireImage: boolean };
type Feed = { items: Item[]; clients: ClientLite[]; live: LiveAll; limits: Limits; canWrite: boolean; chromes?: { online: number; total: number; problems: number } | null };

/**
 * v4.63.0 (Olivier: "the column idea is not working … too long to scroll down
 * or right"). Seven side-by-side columns became tabs, one per step, with the
 * posts of each tab listed compactly and grouped by company. A company shows
 * its next 5 posts; "Show all" opens the rest. Nothing scrolls sideways.
 */
type TabKey = "todo" | "review" | "approved" | "scheduled" | "published" | "problems";
const TABS: { key: TabKey; label: string; hint: string; match: (i: Item) => boolean }[] = [
  { key: "todo", label: "To do", hint: "Drafts, and posts the client sent back with changes", match: (i) => i.status === "DRAFT" || i.status === "CHANGES_REQUESTED" },
  { key: "review", label: "Waiting for validation", hint: "Sent to the client — waiting for their approval", match: (i) => i.status === "IN_REVIEW" },
  { key: "approved", label: "Approved", hint: "Approved — pick a date to schedule", match: (i) => i.status === "APPROVED" },
  { key: "scheduled", label: "Scheduled", hint: "Go out automatically at their time", match: (i) => i.status === "SCHEDULED" },
  { key: "published", label: "Published", hint: "Last 60 days", match: (i) => i.status === "PUBLISHED" },
  { key: "problems", label: "Needs attention", hint: "Failed or only partly published", match: (i) => i.status === "FAILED" || i.status === "PARTIAL" },
];
const PER_GROUP = 5;

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
      // v4.59.0 audit: a successful load clears a stale error banner.
      if (j?.success) { setFeed(j.data); setErr(null); }
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
              <Users size={14} /> Connections
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

      <LiveStrip live={feed?.live ?? null} chromes={feed?.chromes ?? null} />
      <AutopilotStrip />
      <InventoryPanel refreshKey={refreshKey} onPick={setClientFilter} active={clientFilter} />
      {err && <div className="text-sm rounded-lg px-3 py-2 mb-4 bg-red-50 text-red-800">{err}</div>}

      {composing && feed && (
        <Composer
          clients={feed.clients}
          limits={feed.limits}
          defaultClient={clientFilter}
          onDone={(id, warning) => {
            setComposing(false);
            // v4.59.0 audit: the post exists even if a later step failed — reload, open it, then show why.
            void load().then(() => { if (warning) setErr(warning); });
            if (id) setOpenId(id);
          }}
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
        <Board items={items} cutoff={cutoff} clientName={clientName} requireImage={!!feed?.limits.requireImage} onOpen={setOpenId} />
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
  onDone: (id: string | null, warning?: string) => void;
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
    // v4.59.0 audit: once the item exists, a failure in a later step (picture,
    // submit/approve) must not leave the composer open — a retry would create a
    // duplicate. Hand the created id back instead so the board reloads and opens it.
    let id: string | null = null;
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
      id = j.data.id as string;
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
      const m = e instanceof Error ? e.message : "Could not save.";
      if (id) { onDone(id, m); return; }
      setErr(m);
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
        {/* v4.59.0 audit: the API needs a company for every post — disable until one is picked. */}
        <button disabled={busy || preparing || !text.trim() || !clientId || !platforms.length} onClick={() => save("draft")} className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50" title={!clientId ? "Pick the company first" : ""}>
          Save draft
        </button>
        <button disabled={busy || preparing || !text.trim() || !clientId || tooLong || needPic || !platforms.length} onClick={() => save("submit")} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-violet-600 rounded-lg disabled:opacity-50" title={!clientId ? "Pick the client first" : needPic ? "Add a picture first" : ""}>
          <Send size={14} /> Send to client for review
        </button>
        <button disabled={busy || preparing || !text.trim() || !clientId || tooLong || needPic || !platforms.length} onClick={() => save("approve")} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-sky-800 bg-sky-50 border border-sky-200 rounded-lg disabled:opacity-50" title={!clientId ? "Pick the company first" : needPic ? "Add a picture first" : ""}>
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
            (d.emailed ? "The reviewer was emailed." : "No reviewer email is set for this company — add it in Publishing → Connections (Edit).") +
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


/** The content board: one tab per step, posts grouped by company (v4.63.0). */
function Board({
  items, cutoff, clientName, requireImage, onOpen,
}: {
  items: Item[]; cutoff: number; clientName: Map<string, string>; requireImage: boolean; onOpen: (id: string) => void;
}) {
  const inTab = useCallback(
    (t: (typeof TABS)[number]) => items.filter(t.match).filter((i) => t.key !== "published" || new Date(i.updatedAt).getTime() > cutoff),
    [items, cutoff],
  );
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, inTab(t).length])) as Record<TabKey, number>, [inTab]);
  const [tab, setTab] = useState<TabKey | null>(null);
  // First visit: open the first tab that has something to act on.
  const active: TabKey = tab ?? (["problems", "todo", "review", "approved", "scheduled", "published"] as TabKey[]).find((k) => counts[k] > 0) ?? "todo";
  const t = TABS.find((x) => x.key === active)!;
  const list = inTab(t);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of list) {
      const k = i.clientId || "";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    const when = (i: Item) => (i.scheduledAt ? Date.parse(i.scheduledAt) : Date.parse(i.updatedAt));
    const out = Array.from(m.entries()).map(([k, arr]) => ({
      key: k,
      name: k ? clientName.get(k) || "Unknown company" : "No company",
      items: arr.sort((a, b) => (active === "published" ? when(b) - when(a) : when(a) - when(b))),
    }));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [list, clientName, active]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3 border-b border-gray-200 pb-2">
        {TABS.map((x) => {
          const on = x.key === active;
          const n = counts[x.key];
          const alarm = x.key === "problems" && n > 0;
          return (
            <button
              key={x.key}
              onClick={() => setTab(x.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-colors ${
                on ? "bg-red-600 border-red-600 text-white" : alarm ? "bg-red-50 border-red-200 text-red-800 hover:bg-red-100" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {x.label}
              <span className={`text-[11px] px-1.5 rounded-full ${on ? "bg-white/25 text-white" : alarm ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"}`}>{n}</span>
            </button>
          );
        })}
      </div>
      <div className="text-xs text-gray-500 mb-3">{t.hint}{groups.length > 1 ? ` · ${list.length} posts for ${groups.length} companies` : ""}</div>

      {list.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-6 text-center">Nothing here.</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            const showAll = expanded.has(g.key);
            const shown = showAll ? g.items : g.items.slice(0, PER_GROUP);
            const feedbackN = g.items.filter((i) => i.clientFeedback || i.status === "CHANGES_REQUESTED").length;
            const late = g.items.filter((i) => i.status === "IN_REVIEW" && Date.now() - new Date(i.submittedAt || i.updatedAt).getTime() >= 2 * 86400000).length;
            return (
              <section key={g.key} className="bg-white rounded-xl border border-gray-200">
                <button
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                  className="w-full flex flex-wrap items-center gap-2 px-4 py-2.5 text-left"
                >
                  {isCollapsed ? <ChevronRight size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
                  <span className="text-sm font-semibold text-gray-900">{g.name}</span>
                  <span className="text-[11px] px-1.5 rounded-full bg-gray-100 text-gray-600">{g.items.length}</span>
                  {active === "review" && feedbackN > 0 && <span className="text-[11px] px-2 rounded-full bg-orange-50 text-orange-700">{feedbackN} with comments</span>}
                  {active === "review" && late > 0 && <span className="text-[11px] px-2 rounded-full bg-red-50 text-red-700">{late} waiting 2+ days</span>}
                  {g.items[0]?.scheduledAt && (
                    <span className="ml-auto text-[11px] text-gray-500">
                      {fmt(g.items[0].scheduledAt)}{g.items.length > 1 && g.items[g.items.length - 1].scheduledAt ? ` → ${fmt(g.items[g.items.length - 1].scheduledAt!)}` : ""}
                    </span>
                  )}
                </button>
                {!isCollapsed && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {shown.map((i) => <Row key={i.id} i={i} requireImage={requireImage} onOpen={onOpen} />)}
                    {g.items.length > PER_GROUP && (
                      <button
                        onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                        className="w-full text-xs text-gray-600 hover:text-gray-900 py-2"
                      >
                        {showAll ? "Show fewer" : `Show all ${g.items.length}`}
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ i, requireImage, onOpen }: { i: Item; requireImage: boolean; onOpen: (id: string) => void }) {
  const firstLine = (i.title || i.text.split("\n").find((l) => l.trim()) || "").trim();
  const waiting = i.status === "IN_REVIEW" || i.status === "CHANGES_REQUESTED"
    ? Math.floor((Date.now() - new Date(i.status === "IN_REVIEW" ? i.submittedAt || i.updatedAt : i.updatedAt).getTime()) / 86400000)
    : null;
  const lateWait = waiting !== null && (i.status === "IN_REVIEW" ? waiting >= 2 : waiting >= 1);
  return (
    <button onClick={() => onOpen(i.id)} className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50">
      {i.media && i.media[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaSrc(i.media[0])} alt="" loading="lazy" className="w-12 h-12 object-cover rounded-md bg-gray-100 shrink-0" />
      ) : (
        <div className={`w-12 h-12 rounded-md shrink-0 flex items-center justify-center text-[10px] text-center leading-tight ${requireImage ? "bg-orange-50 text-orange-700" : "bg-gray-100 text-gray-400"}`}>no picture</div>
      )}
      <div className="w-[128px] shrink-0 text-[11.5px] text-gray-600 whitespace-nowrap">{i.scheduledAt ? shortWhen(i.scheduledAt) : <span className="text-gray-400">no date</span>}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{firstLine}</div>
        <div className="text-xs text-gray-500 truncate">{i.title ? i.text.replace(/\s+/g, " ").slice(0, 160) : ""}</div>
      </div>
      <div className="hidden sm:flex items-center gap-1 shrink-0">{nets(i.platforms).map((n) => <NetChip key={n} n={n} />)}</div>
      <div className="shrink-0 flex items-center gap-2 text-[11px] text-gray-500">
        {(i._count?.comments ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{i._count?.comments}</span>}
        {waiting !== null && <span className={lateWait ? "text-orange-700 font-medium" : ""}>{waiting === 0 ? "today" : `${waiting}d`}</span>}
        {["IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED"].includes(i.status) ? <ReviewBadge status={i.status} clientFeedback={i.clientFeedback} /> : <ItemBadge s={i.status} />}
      </div>
    </button>
  );
}

function shortWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
