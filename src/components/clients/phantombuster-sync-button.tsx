"use client";

import { useState } from "react";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

interface PlatformPhase {
  platform: string;
  phantomId: string | null;
  containerId: string | null;
  phase: "queued" | "launching" | "running" | "importing" | "done" | "fail";
  status?: string | null;
  rowsParsed?: number;
  postsUpserted?: number;
  message?: string;
}

const POLL_MS = 6000;
const POLL_DEADLINE_MS = 5 * 60 * 1000; // give Phantombuster up to 5 minutes per phantom

export function PhantombusterSyncButton({ clientId }: { clientId?: string }) {
  const [running, setRunning] = useState(false);
  const [phases, setPhases] = useState<PlatformPhase[]>([]);
  const [topError, setTopError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function setPhase(platform: string, patch: Partial<PlatformPhase>) {
    setPhases((prev) => prev.map((p) => (p.platform === platform ? { ...p, ...patch } : p)));
  }

  async function pollOne(p: PlatformPhase) {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`/api/phantombuster/check?phantomId=${encodeURIComponent(p.phantomId!)}`, { cache: "no-store" });
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await r.json();
          if (j.success) {
            const status = j.data?.status as string | null;
            setPhase(p.platform, { status });
            if (status && status !== "running") {
              return { status, resultUrl: j.data?.resultUrl as string | null };
            }
          }
        }
      } catch {
        // ignore — retry until deadline
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return { status: "timeout", resultUrl: null };
  }

  async function run() {
    setRunning(true);
    setTopError(null);
    setOpen(true);
    setPhases([
      { platform: "TWITTER", phantomId: null, containerId: null, phase: "queued" },
      { platform: "LINKEDIN", phantomId: null, containerId: null, phase: "queued" },
    ]);

    try {
      // Step 1: launch both phantoms
      const lr = await fetch("/api/phantombuster/launch", { method: "POST" });
      const lct = lr.headers.get("content-type") || "";
      if (!lct.includes("application/json")) {
        setTopError(`Launch returned non-JSON (HTTP ${lr.status}).`);
        setRunning(false);
        return;
      }
      const lj = await lr.json();
      if (!lj.success) {
        setTopError(lj.error || "Launch failed.");
        setRunning(false);
        return;
      }
      const launches = (lj.data?.launches ?? []) as Array<{ platform: string; phantomId: string | null; containerId: string | null; error?: string }>;
      setPhases(launches.map((l) => ({
        platform: l.platform,
        phantomId: l.phantomId,
        containerId: l.containerId,
        phase: l.error ? "fail" : (l.containerId ? "running" : "fail"),
        message: l.error || (l.containerId ? "Phantom launched. Waiting for results…" : "No phantom configured."),
      })));

      // Step 2 + 3: for each successfully-launched phantom, poll then import
      await Promise.all(
        launches.map(async (l) => {
          if (!l.containerId || !l.phantomId) return;
          const { status, resultUrl } = await pollOne({
            platform: l.platform,
            phantomId: l.phantomId,
            containerId: l.containerId,
            phase: "running",
          });
          if (status !== "success") {
            setPhase(l.platform, { phase: "fail", status, message: `Phantom finished with status: ${status}` });
            return;
          }
          if (!resultUrl) {
            setPhase(l.platform, { phase: "fail", status, message: "Phantom finished but no result CSV URL." });
            return;
          }
          setPhase(l.platform, { phase: "importing", message: "Downloading + importing CSV…" });
          const ir = await fetch("/api/phantombuster/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform: l.platform, phantomId: l.phantomId, resultUrl }),
          });
          const ict = ir.headers.get("content-type") || "";
          if (!ict.includes("application/json")) {
            setPhase(l.platform, { phase: "fail", message: `Import returned non-JSON (HTTP ${ir.status})` });
            return;
          }
          const ij = await ir.json();
          if (!ij.success) {
            setPhase(l.platform, { phase: "fail", message: ij.error || "Import failed" });
            return;
          }
          setPhase(l.platform, {
            phase: "done",
            rowsParsed: ij.data?.rowsParsed ?? 0,
            postsUpserted: ij.data?.postsUpserted ?? 0,
            message: `${ij.data?.postsUpserted ?? 0} posts upserted (parsed ${ij.data?.rowsParsed ?? 0} rows)`,
          });
        })
      );
    } catch (e) {
      setTopError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#0A66C2] rounded-lg hover:bg-[#0852a0] disabled:opacity-60"
        title="Launch the configured Phantoms, wait for them to finish (browser-side polling), and import the posts they collected"
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {running ? "Running phantoms…" : "Sync via Phantombuster"}
      </button>

      {open && (running || phases.length > 0 || topError) && (
        <div className="absolute right-0 top-full mt-2 z-30 w-96 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              {running ? "Running Phantombuster…" : "Phantombuster results"}
            </span>
            {!running && (
              <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
            {topError && (
              <div className="px-4 py-3 text-xs text-red-700 bg-red-50 inline-flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{topError}</span>
              </div>
            )}
            {phases.map((p) => {
              const Icon = p.phase === "done" ? CheckCircle2 : (p.phase === "fail" ? AlertTriangle : Loader2);
              const color = p.phase === "done" ? "text-green-500" : (p.phase === "fail" ? "text-red-500" : "text-blue-500");
              const spin = p.phase === "running" || p.phase === "importing" || p.phase === "launching";
              return (
                <div key={p.platform} className="px-4 py-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-900">{p.platform}{p.phantomId ? ` · ${p.phantomId}` : ""}</span>
                    <Icon size={14} className={`${color} ${spin ? "animate-spin" : ""}`} />
                  </div>
                  <div className={p.phase === "fail" ? "text-red-700" : "text-gray-600"}>
                    {p.message ?? p.phase}
                    {p.status && p.phase === "running" ? ` · status=${p.status}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
          {!running && phases.some((p) => (p.postsUpserted ?? 0) > 0) && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Reload to see the new posts in this page.</span>
              <button
                onClick={() => window.location.assign(window.location.pathname + window.location.search)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Reload now
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
