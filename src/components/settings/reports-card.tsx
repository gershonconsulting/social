"use client";

/**
 * Settings → Reports (v4.71.0) — every email social.gershon.ai sends, who
 * receives it and how often. Gershon workspace admins only (hidden otherwise).
 */
import { useEffect, useState } from "react";
import { Mail, Loader2, CheckCircle2, ExternalLink, RotateCcw } from "lucide-react";

interface Row {
  id: string; name: string; what: string; group: string; when: string; note?: string; previewUrl?: string;
  to: string[]; frequency: string; custom: boolean; defaultRecipients: string[];
  frequencies: Array<{ value: string; label: string }>;
}
interface Data { count: number; alerts: number; reports: Row[] }

export function ReportsCard() {
  const [data, setData] = useState<Data | null>(null);
  const [hidden, setHidden] = useState(false);
  const [draft, setDraft] = useState<Record<string, { to: string; frequency: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function fill(d: Data) {
    setData(d);
    const next: Record<string, { to: string; frequency: string }> = {};
    for (const r of d.reports) next[r.id] = { to: r.to.join(", "), frequency: r.frequency };
    setDraft(next);
  }

  useEffect(() => {
    fetch("/api/settings/reports", { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) { setHidden(true); return; } const j = await r.json(); if (j.success) fill(j.data); else setError(j.error || "Could not load"); })
      .catch(() => setError("Could not load the report settings"));
  }, []);

  async function put(body: unknown, id: string) {
    setSaving(id); setError(null); setSaved(null);
    try {
      const r = await fetch("/api/settings/reports", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Save failed");
      fill(j.data); setSaved(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  if (hidden) return null;

  const groups = data ? Array.from(new Set(data.reports.map((r) => r.group))) : [];

  return (
    <div id="reports" className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-start gap-2">
        <Mail size={16} className="text-[#FE1B04] mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-gray-900">
            Reports {data && <span className="text-gray-500 font-normal">— {data.count} reports + {data.alerts} alerts</span>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Every email this platform sends: who receives it and how often. Separate several addresses with commas. Times are New York time.</div>
        </div>
      </div>

      {!data && !error && <div className="p-4 text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {error && <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">{error}</div>}

      {groups.map((g) => (
        <div key={g}>
          <div className="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g}</div>
          {data!.reports.filter((r) => r.group === g).map((r) => {
            const d = draft[r.id] || { to: "", frequency: r.frequency };
            const dirty = d.to !== r.to.join(", ") || d.frequency !== r.frequency;
            return (
              <div key={r.id} className="px-4 py-3 border-t border-gray-100 grid gap-3 md:grid-cols-[1.2fr_1.6fr_auto] md:items-start">
                <div>
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    {r.name}
                    {r.previewUrl && <a href={r.previewUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-700" title="Preview"><ExternalLink size={12} /></a>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{r.what}</div>
                  <div className="text-[11px] text-gray-400 mt-1">Runs: {r.when}</div>
                </div>
                <div>
                  <input
                    value={d.to}
                    onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, to: e.target.value } })}
                    className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5"
                    placeholder="name@gershonconsulting.com"
                  />
                  {r.note && <div className="text-[11px] text-gray-500 mt-1">{r.note}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={d.frequency}
                    onChange={(e) => setDraft({ ...draft, [r.id]: { ...d, frequency: e.target.value } })}
                    className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
                  >
                    {r.frequencies.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <button
                    disabled={!dirty || saving === r.id}
                    onClick={() => put({ reports: { [r.id]: { to: d.to, frequency: d.frequency } } }, r.id)}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-[#FE1B04] rounded-lg disabled:opacity-40"
                  >
                    {saving === r.id ? <Loader2 size={14} className="animate-spin" /> : "Save"}
                  </button>
                  {saved === r.id && !dirty && <CheckCircle2 size={16} className="text-green-600" />}
                  {r.custom && (
                    <button onClick={() => put({ reset: r.id }, r.id)} title={`Back to default (${r.defaultRecipients.join(", ")})`} className="text-gray-400 hover:text-gray-700">
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
