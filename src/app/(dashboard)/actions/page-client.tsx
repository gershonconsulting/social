"use client";

/**
 * Actions (v4.70.0) — what the Competitive report says to DO, as cards.
 *
 * Three pillars (Promote / Network / Engage). Each card: why, the post it is
 * based on, a draft written on demand (editable, copyable), and one click to
 * mark it done or dismiss it. Promote drafts for campaign / internal companies
 * can be sent to Publish as a draft. On top: what happened with last week's
 * actions, and a nudge when the workspace watches fewer than 3 competitors.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, Megaphone, MessageSquare, RefreshCw, Send, Users, X, ExternalLink } from "lucide-react";

type Pillar = "PROMOTE" | "NETWORK" | "ENGAGE";
type Card = {
  id: string;
  dayKey: string;
  pillar: Pillar;
  priority: "high" | "medium" | "low";
  forCompany: string;
  action: string;
  why: string;
  basedOn: string;
  links: Array<{ label: string; href: string }>;
  draft: string | null;
  postUrl: string | null;
  status: "open" | "done" | "dismissed";
  doneAt: string | null;
  publishItemId: string | null;
  canPublish: boolean;
};
type Result = {
  card: Card;
  postsAfter: number;
  postsPerWeekBefore: number;
  engagementPerPostAfter: number | null;
  engagementPerPostBefore: number | null;
  inProgress: boolean;
};
type Data = {
  cards: Card[];
  results: { created: number; done: number; dismissed: number; open: number; byPillar: Record<Pillar, { created: number; done: number }>; results: Result[] };
  competitors: number;
  canEdit: boolean;
  publishOrigin: string;
};

const PILLARS: Array<{ key: Pillar; label: string; hint: string; icon: React.ReactNode }> = [
  { key: "PROMOTE", label: "Promote", hint: "Post on what works for them — or on what they leave out", icon: <Megaphone size={14} /> },
  { key: "NETWORK", label: "Network", hint: "Reach out to the people and partners behind it", icon: <Users size={14} /> },
  { key: "ENGAGE", label: "Engage", hint: "Comment on and share the posts that matter", icon: <MessageSquare size={14} /> },
];
const PRIO: Record<Card["priority"], string> = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-50";

export function ActionsPageClient() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [show, setShow] = useState<"open" | "done" | "dismissed">("open");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/actions", { cache: "no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Could not load actions");
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load actions");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Opened from an email "Draft it" button: scroll to that card.
  useEffect(() => {
    if (!data || typeof window === "undefined" || !window.location.hash) return;
    const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [data]);

  const post = async (key: string, payload: Record<string, unknown>) => {
    setBusy(key);
    setNotice(null);
    try {
      const r = await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Failed");
      await load();
      return j.data;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const cards = useMemo(() => (data?.cards || []).filter((c) => c.status === show), [data, show]);
  const counts = useMemo(() => {
    const all = data?.cards || [];
    return { open: all.filter((c) => c.status === "open").length, done: all.filter((c) => c.status === "done").length, dismissed: all.filter((c) => c.status === "dismissed").length };
  }, [data]);

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="p-6 text-gray-400 animate-pulse">Loading actions…</div>;

  const res = data.results;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Actions</h1>
          <p className="text-sm text-gray-500 mt-1">What to do this week from what your competitors and partners posted — in the three pillars.</p>
        </div>
        {data.canEdit && (
          <button className={`${btn} border-gray-200 bg-white text-gray-700`} disabled={busy === "refresh"} onClick={() => post("refresh", { op: "refresh" }).then((d) => d && setNotice(`${d.cards} actions for today${d.ai ? "" : " (rule-based — Intelligence was not available)"}.`))}>
            {busy === "refresh" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Find today&apos;s actions
          </button>
        )}
      </div>

      {data.competitors < 3 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          You watch <b>{data.competitors}</b> competitor{data.competitors === 1 ? "" : "s"}. Actions come from what competitors and partners post — add at least 3 so there is something to act on.{" "}
          <Link href="/welcome" className="font-semibold underline">Add competitors</Link>
        </div>
      )}
      {notice && <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">{notice}</div>}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-sm font-semibold text-gray-900">Last 7 days</div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Kpi label="Suggested" value={res.created} />
          <Kpi label="Done" value={res.done} tone="text-emerald-700" />
          <Kpi label="Dismissed" value={res.dismissed} />
          <Kpi label="Still open" value={res.open} tone={res.open ? "text-amber-700" : undefined} />
        </div>
        <div className="mt-2 text-xs text-gray-500">{PILLARS.map((p) => `${p.label} ${res.byPillar[p.key].done}/${res.byPillar[p.key].created}`).join(" · ")}</div>
        {res.results.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">What happened after the actions marked done</div>
            {res.results.map((r) => (
              <div key={r.card.id} className="text-sm">
                <b>{r.card.forCompany}</b> — {r.card.action}
                <div className="text-gray-600">
                  Since then: <b>{r.postsAfter}</b> post{r.postsAfter === 1 ? "" : "s"} (usual week {r.postsPerWeekBefore}) ·{" "}
                  {r.engagementPerPostAfter === null ? "no post yet" : `${r.engagementPerPostAfter} engagements per post (usually ${r.engagementPerPostBefore ?? "—"})`}
                  {r.inProgress && <span className="text-gray-400"> · still counting</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {(["open", "done", "dismissed"] as const).map((s) => (
          <button key={s} onClick={() => setShow(s)} className={`${btn} ${show === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200"}`}>
            {s === "open" ? "Open" : s === "done" ? "Done" : "Dismissed"} · {counts[s]}
          </button>
        ))}
      </div>

      {cards.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
          {show === "open" ? "No open action. New ones arrive every morning with the Competitive report — or click “Find today’s actions”." : "Nothing here yet."}
        </div>
      )}

      {PILLARS.map((p) => {
        const mine = cards.filter((c) => c.pillar === p.key);
        if (!mine.length) return null;
        return (
          <section key={p.key} className="space-y-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#FE1B04]">{p.icon} {p.label} · {mine.length}</div>
              <div className="text-xs text-gray-500">{p.hint}</div>
            </div>
            {mine.map((c) => {
              const text = edits[c.id] ?? c.draft ?? "";
              return (
                <div key={c.id} id={c.id} className="rounded-xl border border-gray-200 bg-white p-4 scroll-mt-24">
                  <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full border font-bold ${PRIO[c.priority]}`}>{c.priority.toUpperCase()}</span>
                    <span>For <b className="text-gray-900">{c.forCompany}</b></span>
                    <span>· {c.dayKey}</span>
                  </div>
                  <div className="mt-2 font-semibold text-gray-900">{c.action}</div>
                  {c.why && <div className="mt-1 text-sm text-gray-600">{c.why}</div>}
                  {c.basedOn && <div className="mt-1 text-xs text-gray-400">Based on: {c.basedOn}</div>}
                  {c.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {c.links.map((l) => (
                        <a key={l.href} href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="text-[#FE1B04] font-semibold inline-flex items-center gap-1">
                          {l.label} <ExternalLink size={11} />
                        </a>
                      ))}
                    </div>
                  )}

                  {(text || c.status === "open") && (
                    <div className="mt-3">
                      {text ? (
                        <textarea
                          className="w-full min-h-[110px] px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#FE1B04]"
                          value={text}
                          disabled={!data.canEdit}
                          onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })}
                          onBlur={() => edits[c.id] !== undefined && edits[c.id] !== c.draft && post(`save-${c.id}`, { op: "save-draft", id: c.id, text: edits[c.id] })}
                        />
                      ) : null}
                    </div>
                  )}

                  {data.canEdit && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.status === "open" && (
                        <button className={`${btn} bg-[#FE1B04] text-white border-[#FE1B04]`} disabled={busy === `draft-${c.id}`} onClick={() => post(`draft-${c.id}`, { op: "draft", id: c.id }).then(() => setEdits((e) => { const n = { ...e }; delete n[c.id]; return n; }))}>
                          {busy === `draft-${c.id}` ? <Loader2 size={13} className="animate-spin" /> : null}
                          {text ? "Write it again" : c.pillar === "PROMOTE" ? "Draft the post" : c.pillar === "ENGAGE" ? "Draft the comment" : "Draft the note"}
                        </button>
                      )}
                      {text && (
                        <button className={`${btn} bg-white text-gray-700 border-gray-200`} onClick={() => navigator.clipboard.writeText(text).then(() => setNotice("Copied."))}>
                          <Copy size={13} /> Copy
                        </button>
                      )}
                      {c.postUrl && (
                        <a className={`${btn} bg-white text-gray-700 border-gray-200`} href={c.postUrl} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} /> Open the post
                        </a>
                      )}
                      {c.canPublish && text && (
                        c.publishItemId ? (
                          <a className={`${btn} bg-white text-gray-700 border-gray-200`} href={`${data.publishOrigin}/?item=${c.publishItemId}`} target="_blank" rel="noreferrer">
                            <Send size={13} /> In Publish
                          </a>
                        ) : (
                          <button className={`${btn} bg-white text-gray-700 border-gray-200`} disabled={busy === `pub-${c.id}`} onClick={() => post(`pub-${c.id}`, { op: "publish", id: c.id }).then((d) => d && setNotice("Sent to Publish as a draft — validate it there."))}>
                            {busy === `pub-${c.id}` ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send to Publish
                          </button>
                        )
                      )}
                      {c.status !== "done" && (
                        <button className={`${btn} bg-emerald-50 text-emerald-700 border-emerald-200`} disabled={busy === `done-${c.id}`} onClick={() => post(`done-${c.id}`, { op: "status", id: c.id, status: "done" })}>
                          <Check size={13} /> Done
                        </button>
                      )}
                      {c.status !== "dismissed" && (
                        <button className={`${btn} bg-gray-50 text-gray-600 border-gray-200`} disabled={busy === `dis-${c.id}`} onClick={() => post(`dis-${c.id}`, { op: "status", id: c.id, status: "dismissed" })}>
                          <X size={13} /> Dismiss
                        </button>
                      )}
                      {c.status !== "open" && (
                        <button className={`${btn} bg-white text-gray-600 border-gray-200`} onClick={() => post(`re-${c.id}`, { op: "status", id: c.id, status: "open" })}>
                          Reopen
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${tone || "text-gray-900"}`}>{value}</div>
    </div>
  );
}
