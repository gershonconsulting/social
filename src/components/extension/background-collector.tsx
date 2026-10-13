"use client";

/**
 * Background collection (v4.44.0, extension 0.19.0).
 *
 * The dashboard asks; a Chrome running the extension does the work. Requests
 * go to a queue on the server (/api/collect/request, /api/collect/queue); every listening Chrome
 * checks it once a minute, takes the job and reports back. Works from any
 * browser — this one does not need the extension.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, Loader2, Play, Radio, XCircle, AlertTriangle } from "lucide-react";

export type CollectJob = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  requestedAt: string;
  status: "queued" | "running" | "done" | "failed" | "expired";
  claimedAt?: string;
  finishedAt?: string;
  result?: { upserted: number; failed: number; accounts: number; errors: string[] };
  error?: string;
};
export type CollectAgent = { id: string; label: string; version: string; lastSeenAt: string; live: boolean };
export type QueueView = { jobs: CollectJob[]; agents: CollectAgent[]; listening: number; job?: CollectJob | null };

export async function requestBackgroundCollection(clientId: string | null): Promise<{ job: CollectJob; listening: number }> {
  const r = await fetch("/api/collect/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clientId ? { clientId } : {}),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.data;
}

export async function fetchQueue(jobId?: string): Promise<QueueView> {
  const r = await fetch("/api/collect/queue" + (jobId ? `?id=${encodeURIComponent(jobId)}` : ""), { cache: "no-store" });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.data;
}

export function ago(iso: string | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function versionLt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** One line describing where a job is. */
export function jobLine(j: CollectJob, listening: number): string {
  const who = j.clientName || "every company";
  switch (j.status) {
    case "queued":
      return listening
        ? `Waiting for a Chrome to pick up ${who} — within a minute.`
        : `Queued for ${who}. No Chrome with the extension is listening right now; it starts as soon as one checks in.`;
    case "running":
      return `Collecting ${who} in the background… (started ${ago(j.claimedAt)})`;
    case "done":
      return `Done ${ago(j.finishedAt)} — ${j.result?.upserted ?? 0} posts saved from ${j.result?.accounts ?? 0} accounts.`;
    case "failed":
      return `Failed ${ago(j.finishedAt)} — ${j.error || "no reason given"}`;
    case "expired":
      return j.error || "Not run.";
  }
}

export function JobIcon({ status }: { status: CollectJob["status"] }) {
  if (status === "queued") return <Clock size={15} className="text-gray-500" />;
  if (status === "running") return <Loader2 size={15} className="animate-spin text-gray-600" />;
  if (status === "done") return <CheckCircle2 size={15} className="text-green-600" />;
  if (status === "failed") return <XCircle size={15} className="text-[#FE1B04]" />;
  return <XCircle size={15} className="text-gray-400" />;
}

/** Follow one job until it finishes. */
export function useJobFollower() {
  const [job, setJob] = useState<CollectJob | null>(null);
  const [listening, setListening] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);

  const follow = useCallback((id: string) => {
    stop();
    const poll = async () => {
      try {
        const v = await fetchQueue(id);
        setListening(v.listening);
        if (v.job) setJob(v.job);
        if (v.job && (v.job.status === "queued" || v.job.status === "running")) timer.current = setTimeout(poll, 5000);
      } catch {
        timer.current = setTimeout(poll, 10000);
      }
    };
    timer.current = setTimeout(poll, 3000);
  }, [stop]);

  const start = useCallback(async (clientId: string | null) => {
    setError(null);
    try {
      const d = await requestBackgroundCollection(clientId);
      setJob(d.job);
      setListening(d.listening);
      follow(d.job.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue the collection");
    }
  }, [follow]);

  return { job, listening, error, start, active: !!job && (job.status === "queued" || job.status === "running") };
}

/** The card on /extension: who is listening, collect everything, recent runs. */
export function BackgroundCollectorCard({ latest }: { latest: string }) {
  const [view, setView] = useState<QueueView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const f = useJobFollower();

  const load = useCallback(async () => {
    try { setView(await fetchQueue()); setLoadError(null); } catch (e) { setLoadError(e instanceof Error ? e.message : "failed"); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { if (f.job) void load(); }, [f.job?.status, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const listening = view?.listening ?? 0;

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-2"><Radio size={16} /> Background collection</h2>
      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
        Every Chrome with the extension (v0.19.0 or later) checks in once a minute and runs any collection asked for here —
        in its own window, without this page or any dashboard tab open there. You can ask from any browser or your phone.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => f.start(null)}
          disabled={f.active}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 text-white text-sm font-semibold px-4 py-2 disabled:opacity-40">
          {f.active ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Collect every company in the background
        </button>
        <span className={`text-xs font-semibold ${listening ? "text-green-700" : "text-[#FE1B04]"}`}>
          {view ? (listening ? `${listening} Chrome${listening > 1 ? "s" : ""} listening` : "No Chrome listening right now") : ""}
        </span>
      </div>
      {f.error && <p className="mt-2 text-xs text-[#FE1B04]">{f.error}</p>}
      {f.job && (
        <div className="mt-3 flex items-start gap-2 text-sm text-gray-700">
          <JobIcon status={f.job.status} /> <span>{jobLine(f.job, f.listening)}</span>
        </div>
      )}

      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Chromes that have checked in</h3>
      {loadError && <p className="text-xs text-[#FE1B04] mt-1">{loadError}</p>}
      {view && view.agents.length === 0 && (
        <p className="text-sm text-gray-500 mt-1">None yet. A Chrome appears here within a minute of running extension v0.19.0 or later.</p>
      )}
      {view && view.agents.length > 0 && (
        <ul className="mt-1 divide-y divide-gray-100">
          {view.agents.map((a) => {
            const old = versionLt(a.version, latest);
            return (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${a.live ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="flex-1 min-w-0 truncate text-gray-900">{a.label} <span className="text-gray-400 text-xs">· {a.id.slice(-6)}</span></span>
                <span className={`text-xs tabular-nums ${old ? "text-[#FE1B04] font-semibold" : "text-gray-500"}`}>
                  {old && <AlertTriangle size={12} className="inline mr-1" />}v{a.version}{old ? ` (update to v${latest})` : ""}
                </span>
                <span className="text-xs text-gray-400 w-24 text-right">{ago(a.lastSeenAt)}</span>
              </li>
            );
          })}
        </ul>
      )}

      {view && view.jobs.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent background runs</h3>
          <ul className="mt-1 divide-y divide-gray-100">
            {view.jobs.slice(0, 8).map((j) => (
              <li key={j.id} className="flex items-start gap-2 py-2 text-sm text-gray-700">
                <span className="mt-0.5"><JobIcon status={j.status} /></span>
                <span className="flex-1 min-w-0">{jobLine(j, listening)}</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">asked {ago(j.requestedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
