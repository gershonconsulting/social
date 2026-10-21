"use client";

/**
 * The item panel (v4.37.0): everything about one post — the text for each
 * network, the copywriter ↔ client thread, the review link, scheduling, and
 * per-network publishing results. Used by the board and the calendar.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Check, Copy, ExternalLink, Loader2, MessageSquare, RotateCcw, Send, Trash2, Undo2, X } from "lucide-react";
import {
  act, Counter, DELIVERY_STYLE, EVENT_LABEL, fmt, ItemBadge, liLength, mediaSrc, NET_LABEL, NetChip, nets, PicturePicker, prepareImage,
  toLocalInput, uploadImage, xLength, SuggestXButton,
  type ClientLite, type Item, type Net,
} from "./shared";

export function ItemPanel({
  id, clients, limits, canWrite, onClose, onChanged,
}: {
  id: string;
  clients: ClientLite[];
  limits: { x: number; linkedin: number; images?: number; requireImage?: boolean };
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [item, setItem] = useState<Item | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [textX, setTextX] = useState("");
  const [title, setTitle] = useState("");
  const [platforms, setPlatforms] = useState<Net[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [when, setWhen] = useState(toLocalInput(null));
  const [comment, setComment] = useState("");
  const [reviseOn, setReviseOn] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/publishing/content/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!j?.success) { setErr(j?.error || "Could not load."); return; }
    const it: Item = j.data.item;
    setItem(it);
    setReviewUrl(j.data.reviewUrl);
    setText(it.text);
    setTextX(it.textX || "");
    setTitle(it.title || "");
    setPlatforms(nets(it.platforms));
    setClientId(it.clientId || "");
    if (it.scheduledAt) setWhen(toLocalInput(it.scheduledAt));
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setErr(null);
    const e = await act(id, action, extra);
    if (e) setErr(e);
    await load();
    onChanged();
    setBusy(false);
  }

  async function addPictures(files: File[]) {
    setBusy(true);
    setErr(null);
    // One picture per post: picking again replaces it.
    const f = files[0];
    if (f) {
      try {
        const e = await uploadImage(id, await prepareImage(f), (item?.media?.length ?? 0) > 0);
        if (e) setErr(e);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not read the picture.");
      }
    }
    await load();
    onChanged();
    setBusy(false);
  }

  async function pictureAction(mediaId: string, method: "DELETE" | "PATCH") {
    if (method === "DELETE" && !confirm("Remove this picture?")) return;
    setBusy(true);
    const r = await fetch(`/api/publishing/content/${id}/media/${mediaId}`, { method });
    const j = await r.json().catch(() => null);
    if (!j?.success) setErr(j?.error || "Could not change the picture.");
    await load();
    onChanged();
    setBusy(false);
  }

  async function sendComment() {
    if (!comment.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/publishing/content/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment, revise: reviseOn }),
    });
    const j = await r.json().catch(() => null);
    setNote(null);
    if (!j?.success) setErr(j?.error || "Could not send.");
    else {
      setComment("");
      const rv = j.revised as { revised: boolean; version?: number; reason?: string } | null;
      if (rv?.revised) setNote(`New version ${rv.version} written from your comment — check it above.`);
      else if (rv && reviseOn) setNote(`Comment saved. No new version: ${rv.reason}.`);
    }
    await load();
    onChanged();
    setBusy(false);
  }

  async function remove() {
    if (!confirm("Delete this post? Nothing on LinkedIn or X is touched.")) return;
    await fetch(`/api/publishing/content/${id}`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  if (!item) {
    return (
      <Shell onClose={onClose}>
        <div className="p-6 text-sm text-gray-500 flex items-center gap-2">
          {err ? err : <><Loader2 size={14} className="animate-spin" /> Loading…</>}
        </div>
      </Shell>
    );
  }

  const posted = item.deliveries.some((d) => d.status === "POSTED");
  const posting = item.deliveries.some((d) => d.status === "POSTING");
  const editable = canWrite && !posted && !posting;
  const dirty =
    text.trim() !== item.text || (textX.trim() || null) !== (item.textX || null) || platforms.join(",") !== nets(item.platforms).join(",") ||
    title.trim() !== (item.title || "") || clientId !== (item.clientId || "");
  const approved = !!item.approvedAt && ["APPROVED", "SCHEDULED", "FAILED", "PARTIAL"].includes(item.status);
  const xText = textX.trim() || text;
  const btn = "inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-50";

  return (
    <Shell onClose={onClose}>
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <ItemBadge s={item.status} />
        <span className="text-xs text-gray-500">v{item.version}</span>
        {nets(item.platforms).map((n) => <NetChip key={n} n={n} />)}
        {item.approvedAt && (
          <span className="text-[11px] text-sky-700">
            Approved by {item.approvedBy}{item.approvedRole === "client" ? " (client)" : ""} · {fmt(item.approvedAt)}
          </span>
        )}
        {busy && <Loader2 size={13} className="animate-spin text-gray-400" />}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {err && <div className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800">{err}</div>}

        {/* Content */}
        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select disabled={!editable} value={clientId} onChange={(e) => setClientId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-1.5">
              <option value="">— Company —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input disabled={!editable} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Internal title (optional)" className="text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
          </div>
          <div className="flex items-center gap-3 text-sm">
            {(["LINKEDIN", "TWITTER"] as Net[]).map((n) => (
              <label key={n} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={platforms.includes(n)}
                  onChange={(e) => setPlatforms((p) => (e.target.checked ? [...p, n].sort() : p.filter((x) => x !== n)) as Net[])}
                />
                <NetChip n={n} /> {NET_LABEL[n]}
              </label>
            ))}
          </div>
          <textarea disabled={!editable} value={text} onChange={(e) => setText(e.target.value)} rows={8} className="w-full text-sm border border-gray-300 rounded-lg p-3 disabled:bg-gray-50" />
          <div className="flex gap-3">
            {platforms.includes("LINKEDIN") && <Counter n={liLength(text)} max={limits.linkedin} label="LinkedIn" />}
            {platforms.includes("TWITTER") && <Counter n={xLength(xText)} max={limits.x} label="X" />}
          </div>
          {platforms.includes("TWITTER") && (
            <div>
              <div className="text-[11px] font-medium text-gray-600 mb-1 flex items-center justify-between gap-2">
                <span>X version {xLength(text) > limits.x ? <span className="text-red-600">(needed — the main text is too long for X)</span> : "(optional — the main text is used if empty)"}</span>
                {editable && <SuggestXButton text={text} onSuggest={setTextX} />}
              </div>
              <textarea disabled={!editable} value={textX} onChange={(e) => setTextX(e.target.value)} rows={3} className="w-full text-sm border border-gray-300 rounded-lg p-2 disabled:bg-gray-50" />
            </div>
          )}
          <div>
            <div className="text-[11px] font-medium text-gray-600 mb-1">
              Picture — one per post, the same on LinkedIn and X
              {limits.requireImage && !(item.media?.length) && <span className="text-orange-600"> · required before review or scheduling</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {(item.media || []).map((m) => (
                <div key={m.id} className="relative w-24 h-24 group">
                  <a href={mediaSrc(m)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaSrc(m)} alt="" className="w-24 h-24 object-cover rounded-lg border border-gray-200" />
                  </a>
                  {editable && (
                    <button onClick={() => pictureAction(m.id, "DELETE")} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 text-white text-xs leading-5" aria-label="Remove picture">×</button>
                  )}
                </div>
              ))}
              {editable && <PicturePicker onFiles={addPictures} disabled={busy} replace={(item.media?.length ?? 0) > 0} />}
            </div>
            {editable && item.approvedAt && (item.media?.length ?? 0) > 0 && (
              <div className="text-[11px] text-amber-700 mt-1">Changing the picture makes a new version that needs approving again.</div>
            )}
          </div>
          {editable && dirty && (
            <div className="flex items-center gap-2">
              <button
                disabled={busy}
                className={`${btn} bg-gray-900 text-white border-gray-900`}
                onClick={() => run("edit", { text, textX, platforms, title, clientId: clientId || null })}
              >
                <Check size={12} /> Save changes
              </button>
              {item.approvedAt && <span className="text-[11px] text-amber-700">Saving new wording sends it back to Draft — it needs approving again.</span>}
            </div>
          )}
        </section>

        {/* Workflow actions */}
        {canWrite && !dirty && (
          <section className="flex flex-wrap items-center gap-2">
            {(item.status === "DRAFT" || item.status === "CHANGES_REQUESTED") && (
              <button disabled={busy} onClick={() => run("submit")} className={`${btn} bg-violet-600 text-white border-violet-600`}>
                <Send size={12} /> {item.status === "CHANGES_REQUESTED" ? "Send the new version to the client" : "Send to client for review"}
              </button>
            )}
            {["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED"].includes(item.status) && (
              <button disabled={busy} onClick={() => run("approve")} className={`${btn} bg-white text-sky-800 border-sky-200`}>
                <Check size={12} /> Approve internally
              </button>
            )}
            {approved && (
              <>
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="text-xs border border-gray-300 rounded-lg px-2 py-1.5" />
                <button disabled={busy} onClick={() => run("schedule", { scheduledAt: new Date(when).toISOString() })} className={`${btn} bg-gray-900 text-white border-gray-900`}>
                  <CalendarDays size={12} /> {item.status === "SCHEDULED" ? "Reschedule" : "Schedule"} {nets(item.platforms).map((n) => NET_LABEL[n]).join(" + ")}
                </button>
                <button disabled={busy} onClick={() => run("post_now")} className={`${btn} bg-white text-gray-800 border-gray-300`}>
                  <Send size={12} /> Post now
                </button>
              </>
            )}
            {item.status === "SCHEDULED" && (
              <button disabled={busy} onClick={() => run("unschedule")} className={`${btn} bg-white text-gray-700 border-gray-300`}>Unschedule</button>
            )}
            {item.deliveries.some((d) => d.status === "FAILED" || d.status === "MISSED") && (
              <button disabled={busy} onClick={() => run("retry")} className={`${btn} bg-gray-900 text-white border-gray-900`}>
                <RotateCcw size={12} /> Retry failed networks now
              </button>
            )}
            {editable && item.status !== "DRAFT" && (
              <button disabled={busy} onClick={() => run("reopen")} className={`${btn} bg-white text-gray-700 border-gray-300`}>
                <Undo2 size={12} /> Back to draft
              </button>
            )}
            {!posting && (
              <button disabled={busy} onClick={remove} className={`${btn} bg-white text-red-700 border-red-200 ml-auto`}>
                <Trash2 size={12} />
              </button>
            )}
          </section>
        )}

        {/* Review link */}
        {item.clientId && reviewUrl && (
          <section className="bg-violet-50/60 border border-violet-100 rounded-lg px-3 py-2 text-xs text-violet-900 flex flex-wrap items-center gap-2">
            <span className="font-medium">Client review link</span>
            <code className="truncate max-w-[60%]">{reviewUrl}</code>
            <button
              onClick={() => { try { void navigator.clipboard.writeText(reviewUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
              className="inline-flex items-center gap-1 underline"
            >
              <Copy size={11} /> {copied ? "Copied" : "Copy"}
            </button>
          </section>
        )}

        {/* Deliveries */}
        {item.deliveries.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-700 mb-2">Publishing</h3>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {item.deliveries.map((d) => (
                <div key={d.id} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                  <NetChip n={d.platform} />
                  <span className="text-gray-600 truncate max-w-[180px]">{d.platform === "TWITTER" && d.target ? "@" + d.target : d.target}</span>
                  <span className={`font-medium ${DELIVERY_STYLE[d.status].cls}`}>
                    {DELIVERY_STYLE[d.status].label}
                    {d.status === "POSTED" && (d.verifiedAt ? " · confirmed" : " · confirming")}
                  </span>
                  <span className="text-gray-500">{fmt(d.postedAt || d.scheduledAt)}</span>
                  {d.postUrl && (
                    <a href={d.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline text-gray-700 ml-auto">
                      <ExternalLink size={11} /> View
                    </a>
                  )}
                  {canWrite && (d.status === "FAILED" || d.status === "MISSED") && (
                    <button
                      className="underline text-gray-700 ml-auto"
                      onClick={() => {
                        const url = prompt(`It is on ${NET_LABEL[d.platform]} already? Paste its link (optional):`);
                        if (url !== null) void run("mark_posted", { platform: d.platform, postUrl: url });
                      }}
                    >
                      It went out
                    </button>
                  )}
                  {d.lastError && d.status !== "POSTED" && <div className="w-full text-red-700">{d.lastError}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Thread */}
        <section>
          <h3 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1"><MessageSquare size={12} /> Review thread</h3>
          <div className="space-y-2">
            {(item.comments || []).map((c) =>
              c.kind === "previous_version" ? (
                <PreviousVersion key={c.id} c={c} canUse={editable} onUse={(t, tx) => { setText(t); setTextX(tx); }} />
              ) : c.kind === "revised" ? (
                <div key={c.id} className="rounded-lg px-3 py-2 text-sm bg-emerald-50 border border-emerald-100">
                  <div className="text-[11px] text-emerald-800 mb-0.5"><strong>{c.authorName || "Intelligence"}</strong> · v{c.version} · {fmt(c.createdAt)}</div>
                  <div className="whitespace-pre-wrap break-words text-gray-900">{c.body}</div>
                </div>
              ) : c.kind === "comment" || c.kind === "changes_requested" || (c.kind === "approved" && c.body && c.body !== "Approved internally") ? (
                <div key={c.id} className={`rounded-lg px-3 py-2 text-sm ${c.authorRole === "client" ? "bg-violet-50 border border-violet-100" : "bg-gray-50 border border-gray-100"}`}>
                  <div className="text-[11px] text-gray-500 mb-0.5">
                    <strong className="text-gray-800">{c.authorName || (c.authorRole === "client" ? "Client" : "Team")}</strong>
                    {c.authorRole === "client" ? " · client" : ""} · v{c.version} · {fmt(c.createdAt)}
                    {c.kind === "changes_requested" && <span className="ml-1 text-orange-700 font-medium">asked for changes</span>}
                    {c.kind === "approved" && <span className="ml-1 text-sky-700 font-medium">approved</span>}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-gray-900">{c.body}</div>
                </div>
              ) : (
                <div key={c.id} className="text-[11px] text-gray-500 pl-1">
                  {fmt(c.createdAt)} — {c.kind === "published" || c.kind === "failed" ? "" : <strong>{c.authorName || "Someone"} </strong>}
                  {EVENT_LABEL[c.kind] || c.kind}
                  {c.kind === "scheduled" && c.body ? ` for ${fmt(c.body)}` : ""}
                  {c.kind === "failed" && c.body ? `: ${c.body}` : ""}
                  {c.kind === "edited" ? ` (v${c.version})` : ""}
                </div>
              ),
            )}
          </div>
          {canWrite && (
            <div className="mt-3">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Reply to the client or leave a note…" className="w-full text-sm border border-gray-300 rounded-lg p-2" />
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <button disabled={busy || !comment.trim()} onClick={sendComment} className={`${btn} bg-white text-gray-800 border-gray-300`}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <MessageSquare size={12} />} {busy && reviseOn ? "Writing the new version…" : "Comment"}
                </button>
                {["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED"].includes(item.status) && (
                  <label className="text-[11px] text-gray-600 inline-flex items-center gap-1">
                    <input type="checkbox" checked={reviseOn} onChange={(e) => setReviseOn(e.target.checked)} />
                    Write a new version from this comment
                  </label>
                )}
                {["IN_REVIEW", "CHANGES_REQUESTED"].includes(item.status) && <span className="text-[11px] text-gray-500">The client&apos;s reviewer is emailed.</span>}
              </div>
              {note && <div className="text-[11px] text-emerald-700 mt-1">{note}</div>}
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-white shadow-xl flex flex-col">
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-gray-100 z-10" aria-label="Close">
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

/** The text of a version that a comment replaced (v4.55.0) — can be put back in the editor. */
function PreviousVersion({ c, canUse, onUse }: { c: { id: string; version: number; createdAt: string; body: string | null }; canUse: boolean; onUse: (text: string, textX: string) => void }) {
  const [open, setOpen] = useState(false);
  let v: { text?: string; textX?: string } = {};
  try { v = JSON.parse(c.body || "{}"); } catch {}
  if (!v.text) return null;
  return (
    <div className="text-[11px] text-gray-500 pl-1">
      <button onClick={() => setOpen((o) => !o)} className="underline">{open ? "Hide" : "Show"} version {c.version} (before the comment)</button>
      {open && (
        <div className="mt-1 rounded-lg border border-gray-200 bg-white p-2 text-sm text-gray-800 whitespace-pre-wrap break-words">
          {v.text}
          {canUse && (
            <div className="mt-2">
              <button onClick={() => onUse(v.text || "", v.textX || "")} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-gray-300 bg-white">
                <Undo2 size={11} /> Put this version back in the editor
              </button>
              <span className="ml-2 text-gray-500">then “Save changes”.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
