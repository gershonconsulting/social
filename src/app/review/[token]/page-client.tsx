"use client";

/**
 * Client review portal (v4.37.0) — the CloudCampaign-style approval page.
 * The client sees each post as it will look on LinkedIn and X, comments,
 * asks for changes or approves. Nothing is published before they approve.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, MessageSquare, PencilLine } from "lucide-react";

type Comment = { id: string; authorName: string | null; authorRole: "team" | "client"; kind: string; body: string | null; version: number; createdAt: string };
type Item = {
  id: string; title: string | null; text: string; textX: string | null; platforms: string; status: string; scheduledAt: string | null;
  version: number; approvedAt: string | null; approvedBy: string | null; updatedAt: string; comments: Comment[];
  deliveries: { platform: string; status: string; postUrl: string | null; postedAt: string | null }[];
  media: { id: string; key: string; position: number; width: number | null; height: number | null }[];
};
type Data = { client: string; logoUrl: string | null; agency: string; items: Item[] };

const NAME_KEY = "review_name";
function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}
const STATUS: Record<string, { label: string; cls: string }> = {
  IN_REVIEW: { label: "Waiting for your review", cls: "bg-violet-100 text-violet-800" },
  CHANGES_REQUESTED: { label: "Changes requested — being revised", cls: "bg-orange-100 text-orange-800" },
  APPROVED: { label: "Approved", cls: "bg-sky-100 text-sky-800" },
  SCHEDULED: { label: "Approved · scheduled", cls: "bg-amber-100 text-amber-800" },
  PUBLISHED: { label: "Published", cls: "bg-emerald-100 text-emerald-800" },
  PARTIAL: { label: "Published", cls: "bg-emerald-100 text-emerald-800" },
};

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
  const revising = data.items.filter((i) => i.status === "CHANGES_REQUESTED");
  const done = data.items.filter((i) => !["IN_REVIEW", "CHANGES_REQUESTED"].includes(i.status));

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center gap-3">
          {data.logoUrl && <img src={data.logoUrl} alt="" className="w-10 h-10 rounded-md object-contain bg-white border border-gray-100" />}
          <div className="flex-1">
            <div className="text-xs text-gray-500">{data.agency} · content review</div>
            <h1 className="text-xl font-semibold text-gray-900">{data.client}</h1>
          </div>
          <label className="text-xs text-gray-600">
            Your name
            <input value={name} onChange={(e) => rememberName(e.target.value)} placeholder="So we know who replied" className="block mt-1 text-sm border border-gray-300 rounded-md px-2 py-1 w-48" />
          </label>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        <Section title={`Waiting for your review (${waiting.length})`} empty="Nothing to review right now — thank you!">
          {waiting.map((i) => <Post key={i.id} i={i} token={token} name={name} onDone={load} actionable />)}
        </Section>
        {revising.length > 0 && (
          <Section title={`Being revised (${revising.length})`}>
            {revising.map((i) => <Post key={i.id} i={i} token={token} name={name} onDone={load} />)}
          </Section>
        )}
        {done.length > 0 && (
          <Section title="Approved & published (last 60 days)">
            {done.map((i) => <Post key={i.id} i={i} token={token} name={name} onDone={load} compact />)}
          </Section>
        )}
        <p className="text-[11px] text-gray-400 text-center">This private link is for {data.client} only. Nothing is published before you approve it.</p>
      </main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center bg-[#f5f6f8] px-4 text-center">{children}</div>;
}
function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-800 mb-3">{title}</h2>
      {has ? <div className="space-y-4">{children}</div> : <p className="text-sm text-gray-500 bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center">{empty}</p>}
    </section>
  );
}

function Post({ i, token, name, onDone, actionable, compact }: { i: Item; token: string; name: string; onDone: () => void; actionable?: boolean; compact?: boolean }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showThread, setShowThread] = useState(!compact);
  const nets = i.platforms.split(",");
  const st = STATUS[i.status] || { label: i.status, cls: "bg-gray-100 text-gray-700" };

  async function send(action: "comment" | "request_changes" | "approve") {
    if (action !== "approve" && !body.trim()) { setMsg(action === "request_changes" ? "Tell us what to change." : "Write a comment first."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/review/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentId: i.id, action, name, body }) });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not send.");
      setBody("");
      setMsg(action === "approve" ? "Approved — thank you." : action === "request_changes" ? "Sent — the copywriter will revise it." : "Comment sent.");
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not send."); }
    setBusy(false);
  }

  const thread = i.comments.filter((c) => c.kind === "comment" || c.kind === "changes_requested" || (c.kind === "approved" && c.authorRole === "client"));

  return (
    <article className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
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
                  </div>
                  {c.body && <div className="whitespace-pre-wrap text-gray-900">{c.body}</div>}
                </div>
              ))}
            </div>
          )}
          {(actionable || i.status === "CHANGES_REQUESTED") && (
            <>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={actionable ? "Comment, or describe the changes you want…" : "Add a comment…"} className="w-full text-sm border border-gray-300 rounded-lg p-2 bg-white" />
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
                {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
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
