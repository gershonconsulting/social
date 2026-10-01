"use client";

import { useEffect, useState } from "react";
import { Loader2, Target } from "lucide-react";

type Row = { id: string; name: string; status: string; perWeek: number; custom: boolean };

/**
 * Settings → Campaign posting objectives. Posts per week per campaign company
 * (5 by default). Drives the "% of objective reached" in the monthly reports.
 */
export function CampaignObjectivesCard() {
  const [def, setDef] = useState<string>("5");
  const [rows, setRows] = useState<Row[]>([]);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function apply(d: { default: number; companies: Row[] }) {
    setDef(String(d.default));
    setRows(d.companies);
    setVals(Object.fromEntries(d.companies.map((c) => [c.id, String(c.perWeek)])));
  }

  useEffect(() => {
    fetch("/api/settings/campaign-objectives")
      .then((r) => r.json())
      .then((j) => (j?.success ? apply(j.data) : setMsg({ kind: "err", text: j?.error || "Could not load objectives" })))
      .catch(() => setMsg({ kind: "err", text: "Could not load objectives" }))
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const companies: Record<string, number | null> = {};
      for (const r of rows) {
        const v = Number(vals[r.id]);
        companies[r.id] = Number.isFinite(v) && v > 0 ? v : null;
      }
      const res = await fetch("/api/settings/campaign-objectives", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default: Number(def), companies }),
      });
      const j = await res.json();
      if (!j?.success) throw new Error(j?.error || "Save failed");
      apply(j.data);
      setMsg({ kind: "ok", text: "Saved. The monthly reports use these objectives." });
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <Target size={18} className="text-red-600 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold text-gray-900">Campaign posting objectives</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Posts per week each campaign company should publish (LinkedIn + X). The monthly reports show the % of this objective reached.
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          <label className="flex items-center justify-between gap-3 py-2 border-b border-gray-100">
            <span className="text-sm font-medium text-gray-900">Default for every campaign</span>
            <span className="flex items-center gap-2 text-xs text-gray-500">
              <input type="number" min={0.5} max={50} step={0.5} value={def} onChange={(e) => setDef(e.target.value)}
                className="w-20 px-2 py-1 text-sm text-right border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500" />
              posts / week
            </span>
          </label>
          {rows.length === 0 && <div className="text-xs text-gray-500 py-3">No campaign companies yet.</div>}
          {rows.map((r) => (
            <label key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-800">
                {r.name}
                {r.status !== "ACTIVE" && <span className="ml-2 text-[11px] text-gray-400">{r.status.toLowerCase().replace("_", " ")}</span>}
              </span>
              <span className="flex items-center gap-2 text-xs text-gray-500">
                <input type="number" min={0.5} max={50} step={0.5} value={vals[r.id] ?? ""}
                  onChange={(e) => setVals((v) => ({ ...v, [r.id]: e.target.value }))}
                  className="w-20 px-2 py-1 text-sm text-right border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500" />
                posts / week
              </span>
            </label>
          ))}
          <div className="flex items-center gap-3 mt-4">
            <button type="submit" disabled={busy}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
              {busy ? "Saving…" : "Save objectives"}
            </button>
            {msg && (
              <span className={"text-xs px-3 py-1.5 rounded " + (msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>{msg.text}</span>
            )}
          </div>
        </>
      )}
    </form>
  );
}
