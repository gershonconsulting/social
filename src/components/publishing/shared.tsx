"use client";

/**
 * Shared bits for the Publishing pages (v4.37.0): types, status styles,
 * counters, the live LinkedIn/X connection strip and the action helper.
 */

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, WifiOff, XCircle } from "lucide-react";

export type Net = "LINKEDIN" | "TWITTER";
export const NET_LABEL: Record<Net, string> = { LINKEDIN: "LinkedIn", TWITTER: "X" };

export type Delivery = {
  id: string;
  platform: Net;
  target: string | null;
  status: "SCHEDULED" | "POSTING" | "POSTED" | "FAILED" | "MISSED";
  scheduledAt: string;
  postedAt: string | null;
  postUrl: string | null;
  verifiedAt: string | null;
  verifiedVia: string | null;
  lastError: string | null;
};

export type Comment = {
  id: string;
  authorName: string | null;
  authorRole: "team" | "client";
  kind: string;
  body: string | null;
  version: number;
  createdAt: string;
};

export type ItemStatus = "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "PARTIAL" | "FAILED";

export type Item = {
  id: string;
  clientId: string | null;
  title: string | null;
  text: string;
  textX: string | null;
  platforms: string;
  status: ItemStatus;
  scheduledAt: string | null;
  version: number;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedRole: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deliveries: Delivery[];
  media?: Media[];
  comments?: Comment[];
  _count?: { comments: number };
  /** Client commented / asked for changes on the current version (v4.41.0). */
  clientFeedback?: boolean;
};

export type Live = { level: "live" | "signed_out" | "offline" | "never"; label: string };
export type LiveAll = { overall: Live; x: Live; linkedin: Live };
export type ClientLite = { id: string; name: string; clientType: string };

export const ITEM_STYLE: Record<ItemStatus, { label: string; cls: string; dot: string }> = {
  DRAFT: { label: "Draft", cls: "bg-gray-100 text-gray-700", dot: "#9ca3af" },
  IN_REVIEW: { label: "With client", cls: "bg-violet-50 text-violet-700", dot: "#8b5cf6" },
  CHANGES_REQUESTED: { label: "Changes requested", cls: "bg-orange-50 text-orange-700", dot: "#f97316" },
  APPROVED: { label: "Approved", cls: "bg-sky-50 text-sky-700", dot: "#0ea5e9" },
  SCHEDULED: { label: "Scheduled", cls: "bg-amber-50 text-amber-700", dot: "#f59e0b" },
  PUBLISHED: { label: "Published", cls: "bg-emerald-50 text-emerald-700", dot: "#10b981" },
  PARTIAL: { label: "Partly published", cls: "bg-red-50 text-red-700", dot: "#ef4444" },
  FAILED: { label: "Failed", cls: "bg-red-50 text-red-700", dot: "#b91c1c" },
};

export const DELIVERY_STYLE: Record<Delivery["status"], { label: string; cls: string }> = {
  SCHEDULED: { label: "scheduled", cls: "text-amber-700" },
  POSTING: { label: "publishing…", cls: "text-indigo-700" },
  POSTED: { label: "posted", cls: "text-emerald-700" },
  FAILED: { label: "failed", cls: "text-red-700" },
  MISSED: { label: "missed", cls: "text-red-700" },
};

export function ItemBadge({ s }: { s: ItemStatus }) {
  const st = ITEM_STYLE[s] ?? ITEM_STYLE.DRAFT;
  return <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>;
}

export function NetChip({ n }: { n: Net }) {
  return n === "LINKEDIN" ? (
    <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#0A66C2] text-white">in</span>
  ) : (
    <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black text-white">𝕏</span>
  );
}

export function nets(platforms: string): Net[] {
  return platforms.split(",").map((s) => s.trim()).filter((s): s is Net => s === "LINKEDIN" || s === "TWITTER");
}

/** URLs count 23, everything else one per code point (X's rule). */
export function xLength(text: string): number {
  const urlRe = /https?:\/\/\S+/gi;
  const urls = text.match(urlRe) || [];
  return Array.from(text.replace(urlRe, "")).length + urls.length * 23;
}
export function liLength(text: string): number {
  return Array.from(text).length;
}

export function Counter({ n, max, label }: { n: number; max: number; label: string }) {
  const over = n > max;
  return (
    <span className={`text-[11px] tabular-nums ${over ? "text-red-600 font-semibold" : n > max * 0.9 ? "text-amber-600" : "text-gray-500"}`}>
      {label} {n}/{max}
    </span>
  );
}

export function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (!iso) d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LiveStrip({ live, chromes }: { live: LiveAll | null; chromes?: { online: number; total: number; problems: number } | null }) {
  if (!live) return null;
  // v4.63.0: several Chromes can publish — each for the accounts it is signed in
  // to. The strip says how many are online and how many accounts need fixing;
  // the detail is on Publishing → Connections.
  if (chromes && chromes.total > 0) {
    const bad = chromes.online === 0 || chromes.problems > 0;
    return (
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border rounded-lg px-3 py-2 mb-5 text-sm ${bad ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
        <span className="font-medium text-gray-800">Publishing</span>
        <span className={chromes.online ? "text-emerald-700 inline-flex items-center gap-1" : "text-red-700 inline-flex items-center gap-1"}>
          {chromes.online ? <CheckCircle2 size={14} /> : <WifiOff size={14} />} {chromes.online} Chrome{chromes.online === 1 ? "" : "s"} online
        </span>
        {chromes.problems > 0
          ? <span className="text-red-700 inline-flex items-center gap-1"><XCircle size={14} /> {chromes.problems} account{chromes.problems === 1 ? "" : "s"} can&apos;t be posted to yet</span>
          : <span className="text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={14} /> every account connected</span>}
        <Link href="/publishing/accounts" className="ml-auto text-gray-800 underline font-medium">Connections</Link>
      </div>
    );
  }
  const one = (l: Live, name: string) => {
    const ok = l.level === "live";
    const Icon = ok ? CheckCircle2 : l.level === "signed_out" ? XCircle : WifiOff;
    const cls = ok ? "text-emerald-700" : l.level === "signed_out" ? "text-red-700" : "text-amber-700";
    return (
      <span className={`inline-flex items-center gap-1 ${cls}`} title={l.label}>
        <Icon size={14} /> {l.label.replace(/^(X|LinkedIn): /, name + ": ")}
      </span>
    );
  };
  const bad = live.overall.level !== "live";
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border rounded-lg px-3 py-2 mb-5 text-sm ${bad ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
      <span className="font-medium text-gray-800">Publishing browser</span>
      {one(live.linkedin, "LinkedIn")}
      {one(live.x, "X")}
      <Link href="/publishing/accounts" className="ml-auto text-gray-800 underline font-medium">Connections</Link>
    </div>
  );
}

export async function act(id: string, action: string, extra: Record<string, unknown> = {}): Promise<string | null> {
  try {
    const r = await fetch(`/api/publishing/content/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const j = await r.json();
    return j?.success ? null : j?.error || "Failed";
  } catch {
    return "Network error";
  }
}

export const EVENT_LABEL: Record<string, string> = {
  created: "created the post",
  submitted: "sent it to the client for review",
  changes_requested: "asked for changes",
  approved: "approved it",
  edited: "edited it",
  reopened: "reopened it",
  scheduled: "scheduled it",
  published: "Published on every network",
  failed: "Publishing failed",
};

// ── Pictures (v4.38.0) ───────────────────────────────────────────────────────

export type Media = { id: string; key: string; position: number; mime: string; name: string | null; width: number | null; height: number | null; sizeBytes: number };

export function mediaSrc(m: { id: string; key: string }): string {
  return `/api/media/${m.id}?k=${m.key}`;
}

export type Prepared = { dataB64: string; mime: string; name: string; width: number; height: number; preview: string };

const MAX_SIDE = 2048;
const MAX_BYTES = 5 * 1024 * 1024;

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ""));
    r.onerror = () => reject(new Error("Could not read the picture."));
    r.readAsDataURL(blob);
  });
}

/**
 * Get a picture ready for LinkedIn and X in the browser: GIFs are kept as
 * they are (animation), everything else becomes a JPEG at most 2048 px on its
 * longest side — sharp on both networks and a few hundred KB.
 */
export async function prepareImage(file: File): Promise<Prepared> {
  if (!/^image\//.test(file.type)) throw new Error(`${file.name} is not a picture.`);
  const bmp = await createImageBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  if (file.type === "image/gif" && file.size <= MAX_BYTES) {
    return { dataB64: await blobToB64(file), mime: "image/gif", name: file.name, width: w0, height: h0, preview: URL.createObjectURL(file) };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background, not black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  let q = 0.88;
  let blob: Blob | null = null;
  for (let i = 0; i < 4; i++) {
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= MAX_BYTES) break;
    q -= 0.15;
  }
  if (!blob) throw new Error(`Could not prepare ${file.name}.`);
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { dataB64: await blobToB64(blob), mime: "image/jpeg", name, width: w, height: h, preview: URL.createObjectURL(blob) };
}

export async function uploadImage(contentId: string, p: Prepared, replace = false): Promise<string | null> {
  try {
    const r = await fetch(`/api/publishing/content/${contentId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataB64: p.dataB64, mime: p.mime, name: p.name, width: p.width, height: p.height, replace }),
    });
    const j = await r.json();
    return j?.success ? null : j?.error || "Upload failed.";
  } catch {
    return "Upload failed.";
  }
}

/** Picks the post's picture by click or drag-and-drop (one per post; picking again replaces it). */
export function PicturePicker({ onFiles, disabled, replace }: { onFiles: (f: File[]) => void; disabled?: boolean; replace?: boolean }) {
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!disabled) onFiles(Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("image/")).slice(0, 1));
      }}
      className={`flex flex-col items-center justify-center w-24 h-24 rounded-lg border-2 border-dashed text-[11px] text-center leading-tight ${disabled ? "border-gray-200 text-gray-300" : "border-gray-300 text-gray-500 hover:border-gray-500 cursor-pointer"}`}
    >
      <span className="text-xl leading-none">{replace ? "↻" : "+"}</span>
      {replace ? "Replace picture" : "Add picture"}
      <input
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic"
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files || []).slice(0, 1));
          e.target.value = "";
        }}
      />
    </label>
  );
}

/**
 * "Suggest with Intelligence" for the X version (v4.40.0). Sends the main text
 * to /api/publishing/suggest-x, which always answers within the X limit.
 */
export function SuggestXButton({ text, onSuggest, disabled }: { text: string; onSuggest: (t: string) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/publishing/suggest-x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) setErr(j?.error || `HTTP ${r.status}`);
      else onSuggest(j.data.text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={disabled || busy || !text.trim()}
        className="text-[11px] font-medium px-2 py-0.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? "Writing…" : "✨ Suggest X version"}
      </button>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </span>
  );
}

/**
 * Review colours (v4.41.0, Olivier): APPROVED = big green; not approved but
 * with the client's comments = orange "Pending approval"; only submitted,
 * nothing from the client yet = red "Submitted".
 */
export type ReviewTone = "green" | "orange" | "red";
export function reviewState(status: string, clientFeedback?: boolean): { label: string; tone: ReviewTone } | null {
  if (["APPROVED", "SCHEDULED", "PUBLISHED", "PARTIAL"].includes(status)) return { label: "Approved", tone: "green" };
  if (status === "CHANGES_REQUESTED" || (status === "IN_REVIEW" && clientFeedback)) return { label: "Pending approval", tone: "orange" };
  if (status === "IN_REVIEW") return { label: "Submitted", tone: "red" };
  return null;
}
export const TONE_CLS: Record<ReviewTone, string> = {
  green: "bg-emerald-600 text-white",
  orange: "bg-orange-500 text-white",
  red: "bg-red-600 text-white",
};
export function ReviewBadge({ status, clientFeedback, big }: { status: string; clientFeedback?: boolean; big?: boolean }) {
  const s = reviewState(status, clientFeedback);
  if (!s) return null;
  return (
    <span className={`inline-flex items-center justify-center font-bold uppercase tracking-wide rounded-md ${TONE_CLS[s.tone]} ${big ? "text-base px-4 py-2 w-full" : "text-[10px] px-1.5 py-0.5"}`}>
      {s.tone === "green" ? "✓ " : ""}{s.label}
    </span>
  );
}
