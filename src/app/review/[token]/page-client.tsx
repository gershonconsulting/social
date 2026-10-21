"use client";

/**
 * Client review portal (v4.37.0) — the CloudCampaign-style approval page.
 * The client sees each post as it will look on LinkedIn and X, comments,
 * asks for changes or approves. Nothing is published before they approve.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, CheckCheck, Loader2, MessageSquare, PencilLine } from "lucide-react";
import { ReviewBadge } from "@/components/publishing/shared";

type Comment = { id: string; authorName: string | null; authorRole: "team" | "client"; kind: string; body: string | null; version: number; createdAt: string };
type Item = {
  id: string; title: string | null; text: string; textX: string | null; platforms: string; status: string; scheduledAt: string | null;
  version: number; approvedAt: string | null; approvedBy: string | null; updatedAt: string; comments: Comment[];
  deliveries: { platform: string; status: string; postUrl: string | null; postedAt: string | null }[];
  media: { id: string; key: string; position: number; width: number | null; height: number | null }[];
};
type Data = { client: string; logoUrl: string | null; agency: string; items: Item[] };

const NAME_KEY = "review_name";

/** Batch a post was sent in (v4.41.0): the latest "submitted" event's
 *  "batch:<name>", else "<Company> — <Month YYYY>" of its planned date. */
function batchOf(i: Item, client: string): string {
  const sub = [...i.comments].reverse().find((c) => c.kind === "submitted" && (c.body || "").startsWith("batch:"));
  if (sub) return (sub.body as string).slice(6);
  const d = new Date(i.scheduledAt || i.updatedAt);
  return `${client} — ${d.toLocaleString("en-US", { month: "long", year: "numeric" })}`;
}
/** Client feedback on the current version → orange, none → red. */
function hasFeedback(i: Item): boolean {
  return i.comments.some((c) => c.authorRole === "client" && (c.kind === "comment" || c.kind === "changes_requested") && c.version === i.version);
}
function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

export function ReviewClient({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/review/${token}`, { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setData(j.data);
      else setErr(j?.error || "This review link is not valid.");
    } catch { setErr("Could not load."); }
  }, [token]);

  useEffect(() => {
    void load();
    try { setName(localStorage.getItem(NAME_KEY) || ""); } catch {}
  }, [load]);

  function rememberName(v: string) {
    setName(v);
    try { localStorage.setItem(NAME_KEY, v); } catch {}
  }

  if (err) return <Center><p className="text-gray-700">{err}</p></Center>;
  if (!data) return <Center><Loader2 className="animate-spin text-gray-400" /></Center>;

  const waiting = data.items.filter((i) => i.status === "IN_REVIEW");
  const groups = new Map<string, Item[]>();
  for (const i of data.items) {
    const k = batchOf(i, data.client);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  const open = (l: Item[]) => l.some((i) => i.status === "IN_REVIEW" || i.status === "CHANGES_REQUESTED");
  const ordered = Array.from(groups.entries()).sort((x, y) => Number(open(y[1])) - Number(open(x[1])));

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-3">
          {data.logoUrl && <img src={data.logoUrl} alt="" className="w-10 h-10 rounded-md object-contain bg-white border border-gray-100" />}
          <div className="flex-1">
            <div className="text-xs text-gray-500">{data.agency} · content review</div>
            <h1 className="text-2xl font-bold text-gray-900">Content to approve</h1>
          </div>
          <label className="text-xs text-gray-600">
            Your name
            <input value={name} onChange={(e) => rememberName(e.target.value)} placeholder="So we know who replied" className="block mt-1 text-sm border border-gray-300 rounded-md px-2 py-1 w-48" />
          </label>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-10">
        {waiting.length > 0 && <ApproveAll n={waiting.length} token={token} name={name} onDone={load} />}
        {ordered.length === 0 && (
          <p className="text-sm text-gray-500 bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center">Nothing to review right now — thank you!</p>
        )}
        {ordered.map(([batch, list]) => (
          <section key={batch}>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{batch}</h2>
              <div className="text-sm text-gray-500">
                {list.length} item{list.length === 1 ? "" : "s"} · {list.filter((i) => ["APPROVED", "SCHEDULED", "PUBLISHED", "PARTIAL"].includes(i.status)).length} approved
                {open(list) && " · Please approve each post with the button under it."}
              </div>
            </div>
            <div className="space-y-4">
              {list.map((i) => (
                <Post key={i.id} i={i} token={token} name={name} onDone={load} actionable={i.status === "IN_REVIEW"} compact={!["IN_REVIEW", "CHANGES_REQUESTED"].includes(i.status)} />
              ))}
            </div>
          </section>
        ))}
        <p className="text-[11px] text-gray-400 text-center">This private link is for {data.client} only. Nothing is published before you approve it.</p>
      </main>
    </div>
  );
}

function ApproveAll({ n, token, name, onDone }: { n: number; token: string; name: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    if (!confirm(`Approve all ${n} post${n === 1 ? "" : "s"} waiting for your review?`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/review/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_all", name }) });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not approve.");
      setMsg("All approved — thank you.");
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not approve."); }
    setBusy(false);
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
      <div className="flex-1 text-sm text-gray-700"><b>{n}</b> post{n === 1 ? " is" : "s are"} waiting for your approval.</div>
      <button disabled={busy} onClick={go} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-emerald-600 rounded-lg disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={16} />} Approve all ({n})
      </button>
      {msg && <span className="text-xs text-gray-600 w-full">{msg}</span>}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-[#f5f6f8] px-4 text-center">{children}</div>;
}
function Post({ i, token, name, onDone, actionable, compact }: { i: Item; token: string; name: string; onDone: () => void; actionable?: boolean; compact?: boolean }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showThread, setShowThread] = useState(!compact);
  const nets = i.platforms.split(",");

  async function send(action: "comment" | "request_changes" | "approve") {
    if (action !== "approve" && !body.trim()) { setMsg(action === "request_changes" ? "Tell us what to change." : "Write a comment first."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/review/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentId: i.id, action, name, body }) });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not send.");
      setBody("");
      const rv = j.revised as { revised: boolean; version?: number } | null;
      setMsg(
        action === "approve" ? "Approved — thank you."
          : rv?.revised ? `Done — version ${rv.version} is above, written from your comment. Approve it or comment again.`
          : action === "request_changes" ? "Sent — the copywriter will revise it." : "Comment sent.",
      );
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not send."); }
    setBusy(false);
  }

  const thread = i.comments.filter((c) => c.kind === "comment" || c.kind === "changes_requested" || c.kind === "revised" || (c.kind === "approved" && c.authorRole === "client"));

  return (
    <article className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        {i.title && <span className="text-sm font-medium text-gray-900">{i.title}</span>}
        <span className="text-[11px] text-gray-500 ml-auto">Version {i.version}{i.scheduledAt ? ` · planned ${fmt(i.scheduledAt)}` : ""}</span>
      </div>
      <div className={`p-4 grid gap-3 ${nets.length > 1 && !compact ? "md:grid-cols-2" : ""}`}>
        {nets.includes("LINKEDIN") && <Preview net="LinkedIn" color="#0A66C2" text={i.text} media={i.media} compact={compact} />}
        {nets.includes("TWITTER") && (!compact || !nets.includes("LINKEDIN")) && <Preview net="X" color="#000" text={i.textX?.trim() || i.text} media={i.media} compact={compact} />}
      </div>
      {i.deliveries.some((d) => d.postUrl) && (
        <div className="px-4 pb-3 flex gap-3 text-xs">
          {i.deliveries.filter((d) => d.postUrl).map((d) => (
            <a key={d.platform} href={d.postUrl!} target="_blank" rel="noreferrer" className="underline text-gray-700">View on {d.platform === "TWITTER" ? "X" : "LinkedIn"}</a>
          ))}
        </div>
      )}
      <div className="px-4 pb-3">
        <ReviewBadge status={i.status} clientFeedback={hasFeedback(i)} big />
        {i.approvedAt && ["APPROVED", "SCHEDULED", "PUBLISHED", "PARTIAL"].includes(i.status) && (
          <div className="text-[11px] text-gray-500 text-center mt-1">Approved on {new Date(i.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{i.approvedBy ? ` by ${i.approvedBy}` : ""}</div>
        )}
      </div>
      {(thread.length > 0 || actionable) && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/60">
          {thread.length > 0 && (
            <button onClick={() => setShowThread((s) => !s)} className="text-xs text-gray-600 inline-flex items-center gap-1 mb-2">
              <MessageSquare size={12} /> {thread.length} message{thread.length === 1 ? "" : "s"}
            </button>
          )}
          {showThread && (
            <div className="space-y-2 mb-3">
              {thread.map((c) => (
                <div key={c.id} className={`text-sm rounded-lg px-3 py-2 ${c.authorRole === "client" ? "bg-white border border-gray-200 ml-8" : "bg-violet-50 border border-violet-100 mr-8"}`}>
                  <div className="text-[11px] text-gray-500 mb-0.5">
                    <strong className="text-gray-800">{c.authorName || (c.authorRole === "client" ? "You" : "Copywriter")}</strong> · v{c.version} · {fmt(c.createdAt)}
                    {c.kind === "changes_requested" && <span className="ml-1 text-orange-700">asked for changes</span>}
                    {c.kind === "approved" && <span className="ml-1 text-sky-700">approved</span>}
                    {c.kind === "revised" && <span className="ml-1 text-emerald-700">new version</span>}
                  </div>
                  {c.body && <div className="whitespace-pre-wrap text-gray-900">{c.body}</div>}
                </div>
              ))}
            </div>
          )}
          {(actionable || i.status === "CHANGES_REQUESTED") && (
            <>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={actionable ? "Comment, or describe the changes you want — a new version is written from it…" : "Add a comment — a new version is written from it…"} className="w-full text-sm border border-gray-300 rounded-lg p-2 bg-white" />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {actionable && (
                  <button disabled={busy} onClick={() => send("approve")} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg disabled:opacity-50">
                    <Check size={14} /> Approve
                  </button>
                )}
                {actionable && (
                  <button disabled={busy} onClick={() => send("request_changes")} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-orange-800 bg-orange-50 border border-orange-200 rounded-lg disabled:opacity-50">
                    <PencilLine size={14} /> Request changes
                  </button>
                )}
                <button disabled={busy} onClick={() => send("comment")} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg disabled:opacity-50">
                  <MessageSquare size={14} /> Comment only
                </button>
                {busy && <span className="inline-flex items-center gap-1 text-xs text-gray-500"><Loader2 size={14} className="animate-spin text-gray-400" /> {body.trim() ? "Writing the new version…" : ""}</span>}
                {msg && <span className="text-xs text-gray-600">{msg}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function Pictures({ media, compact }: { media: Item["media"]; compact?: boolean }) {
  if (!media?.length) return null;
  const shown = compact ? media.slice(0, 1) : media;
  return (
    <div className={`mt-2 grid gap-1 ${shown.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
      {shown.map((m) => (
        <a key={m.id} href={`/api/media/${m.id}?k=${m.key}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/media/${m.id}?k=${m.key}`}
            alt=""
            loading="lazy"
            className={`w-full rounded-md bg-gray-100 ${shown.length > 1 || compact ? "h-36 object-cover" : "max-h-96 object-contain"}`}
          />
        </a>
      ))}
    </div>
  );
}

function Preview({ net, color, text, media, compact }: { net: string; color: string; text: string; media: Item["media"]; compact?: boolean }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white" style={{ background: color }}>{net === "X" ? "𝕏" : "in"}</span>
        <span className="text-xs text-gray-500">{net} preview</span>
      </div>
      <p className={`text-sm text-gray-900 whitespace-pre-wrap break-words ${compact ? "line-clamp-3" : ""}`}>{text}</p>
      <Pictures media={media} compact={compact} />
    </div>
  );
}
