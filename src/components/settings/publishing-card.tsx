"use client";

/**
 * Settings → "Publishing" (v4.37.0). The live LinkedIn + X connection of the
 * publishing browser and the workspace's publishing settings. Sessions
 * themselves (never a password) are captured by the extension from the
 * signed-in browser — see "Captured sessions" and "Your X account" on this
 * page. The extension checks them every 5 minutes and, if a network signs the
 * browser out, speaks an alert, opens that login page and emails once.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { LiveStrip, type LiveAll } from "@/components/publishing/shared";

type Data = {
  settings: { enabled: boolean; longPostsX: boolean; graceMinutes: number; alertEmail: string | null; requireImage: boolean; readyEmail?: string };
  publisher: { lastSeenAt: string | null; version: string | null; lastPostAt: string | null; lastError: string | null; x: { as: string | null }; linkedin: { as: string | null } };
  live: LiveAll;
  waiting: number;
  canWrite: boolean;
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  return h < 24 ? h + " h ago" : Math.round(h / 24) + " d ago";
}

export function PublishingCard() {
  const [d, setD] = useState<Data | null>(null);
  const [grace, setGrace] = useState(120);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const [ready, setReady] = useState("");
  const apply = (j: Data) => { setD(j); setGrace(j.settings.graceMinutes); setEmail(j.settings.alertEmail || ""); setReady(j.settings.readyEmail || "social@gershonconsulting.com"); };
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/publishing/settings", { cache: "no-store" });
      if (r.status === 401 || r.status === 409) { setHidden(true); return; }
      const j = await r.json();
      if (j?.success) apply(j.data);
    } catch {}
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  async function save(patch: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/publishing/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not save.");
      apply(j.data); setMsg("Saved.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy(false);
  }

  if (hidden) return null;
  const ro = !d?.canWrite;
  return (
    <div id="publishing" className="bg-white rounded-xl border border-gray-200 p-5 mb-6 scroll-mt-6">
      <div className="flex items-start gap-3 mb-4">
        <Send size={18} className="text-gray-900 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">Publishing — LinkedIn &amp; X</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Approved posts are published by the Social Chrome extension from the browser signed in to LinkedIn and X. No password and no API key are stored.
            The connection is checked every 5 minutes; if a network signs that browser out, it speaks an alert, opens the login page and emails you.
          </div>
        </div>
        <Link href="/publishing" className="text-xs font-medium text-gray-700 border border-gray-300 rounded-md px-2.5 py-1 hover:bg-gray-50 shrink-0">Open Publishing</Link>
      </div>
      {!d ? (
        <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking the connection…</div>
      ) : (
        <>
          <LiveStrip live={d.live} />
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-5">
            <div><dt className="text-gray-500">Publishing browser last seen</dt><dd className="font-medium text-gray-900">{ago(d.publisher.lastSeenAt)}</dd></div>
            <div><dt className="text-gray-500">Extension</dt><dd className="font-medium text-gray-900">{d.publisher.version ? "v" + d.publisher.version : "—"}</dd></div>
            <div><dt className="text-gray-500">Last post published</dt><dd className="font-medium text-gray-900">{ago(d.publisher.lastPostAt)}</dd></div>
            <div><dt className="text-gray-500">Waiting to go out</dt><dd className="font-medium text-gray-900">{d.waiting}</dd></div>
          </dl>
          {d.publisher.lastError && <p className="text-xs text-red-700 mb-4">Last problem reported: {d.publisher.lastError}</p>}
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-700">Email for client feedback and publishing problems</span>
              <input disabled={ro} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Workspace admin by default" className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-700">Latest a post may still go out</span>
              <select disabled={ro} value={grace} onChange={(e) => setGrace(Number(e.target.value))} className="mt-1 w-full text-sm border border-gray-300 rounded-lg px-3 py-2">
                {[30, 60, 120, 240, 480, 1440].map((m) => <option key={m} value={m}>{m < 60 ? m + " minutes" : m / 60 + " hour" + (m > 60 ? "s" : "")} after its time</option>)}
              </select>
              <span className="text-[11px] text-gray-500">Later than that it is marked Missed and you are told — never posted late by surprise.</span>
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input disabled={ro} type="checkbox" checked={d.settings.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
                Publishing on (untick to pause every scheduled post)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input disabled={ro} type="checkbox" checked={d.settings.longPostsX} onChange={(e) => save({ longPostsX: e.target.checked })} />
                X Premium — allow X posts longer than 280 characters
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input disabled={ro} type="checkbox" checked={d.settings.requireImage} onChange={(e) => save({ requireImage: e.target.checked })} />
                Every post needs a picture (before review, approval and scheduling)
              </label>
            </div>
          </div>
          <label className="block mt-4 text-sm text-gray-800">
            “Validated — ready for publishing” emails go to
            <input disabled={ro} value={ready} onChange={(e) => setReady(e.target.value)} className="block w-full max-w-sm mt-1 text-sm border border-gray-300 rounded-lg px-2.5 py-1.5" placeholder="social@gershonconsulting.com" />
            <span className="text-[11px] text-gray-500">Sent every time content is approved — by the client, by the team or automatically after 48h.</span>
          </label>
          {!ro && (
            <div className="flex items-center gap-3 mt-4">
              <button disabled={busy} onClick={() => save({ graceMinutes: grace, alertEmail: email, readyEmail: ready })} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save
              </button>
              {msg && <span className="text-xs text-gray-600">{msg}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
