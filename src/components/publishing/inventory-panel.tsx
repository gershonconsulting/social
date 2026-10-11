"use client";

/**
 * Content inventory (v4.39.0) — every client must always have one week of
 * approved content ready to publish. One tile per client, worst first:
 * days of ready content against the 7-day target, what is missing, and what
 * is stuck with the client or with the copywriter. Clicking a tile filters
 * the board to that client.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

export type InvRow = {
  clientId: string; name: string; perWeek: number; ready: number; scheduled: number; approvedUnscheduled: number;
  coverageDays: number; missing: number; runsOutOn: string | null; drafts: number; inReview: number; changesRequested: number;
  oldestReviewDays: number; overdueReviews: number; overdueChanges: number; level: "ok" | "low" | "critical";
};

const LEVEL = {
  critical: { bar: "bg-red-600", tile: "border-red-200 bg-red-50/60", text: "text-red-700" },
  low: { bar: "bg-amber-500", tile: "border-amber-200 bg-amber-50/60", text: "text-amber-700" },
  ok: { bar: "bg-emerald-500", tile: "border-gray-200 bg-white", text: "text-emerald-700" },
} as const;

export function InventoryPanel({ refreshKey, onPick, active }: { refreshKey: number; onPick: (clientId: string) => void; active: string }) {
  const [rows, setRows] = useState<InvRow[] | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/publishing/inventory", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setRows(j.data.rows);
    } catch {}
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  if (!rows || !rows.length) return null;

  const warn = rows.filter((r) => r.level !== "ok").length;
  const stuck = rows.reduce((n, r) => n + r.overdueReviews + r.overdueChanges, 0);

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-baseline gap-3 mb-2">
        <h2 className="text-sm font-semibold text-gray-900">Content inventory — one week ready per client</h2>
        {warn > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700"><AlertTriangle size={13} /> {warn} under one week</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 size={13} /> every client has a week ready</span>
        )}
        {stuck > 0 && <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700"><Clock size={13} /> {stuck} waiting too long</span>}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {rows.map((r) => {
          const L = LEVEL[r.level];
          const pct = Math.min(100, Math.round((r.coverageDays / 7) * 100));
          return (
            <button
              key={r.clientId}
              onClick={() => onPick(active === r.clientId ? "" : r.clientId)}
              className={`shrink-0 w-[210px] text-left rounded-xl border p-3 ${L.tile} ${active === r.clientId ? "ring-2 ring-gray-900/30" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-gray-900 truncate">{r.name}</span>
                <span className={`text-sm font-semibold tabular-nums ${L.text}`}>{r.coverageDays}d</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 mt-1.5 overflow-hidden"><div className={`h-full ${L.bar}`} style={{ width: `${pct}%` }} /></div>
              <div className="text-[11px] text-gray-600 mt-1.5">
                {r.ready} ready · target {r.perWeek}/week
                {r.missing > 0 && <span className={`font-medium ${L.text}`}> · need {r.missing} more</span>}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5 space-x-2">
                {r.inReview > 0 && <span className={r.overdueReviews ? "text-orange-700 font-medium" : ""}>{r.inReview} with client{r.overdueReviews ? ` (${r.oldestReviewDays}d)` : ""}</span>}
                {r.changesRequested > 0 && <span className={r.overdueChanges ? "text-orange-700 font-medium" : ""}>{r.changesRequested} to revise</span>}
                {r.drafts > 0 && <span>{r.drafts} draft{r.drafts === 1 ? "" : "s"}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
