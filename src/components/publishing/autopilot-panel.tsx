"use client";

/**
 * Publishing Autopilot UI (v4.51.0).
 *   <AutopilotStrip/>  — one line on the Publishing board: month being prepared + link.
 *   <AutopilotPage/>   — /publishing/autopilot: progress per company, settings, "Run now".
 * See lib/autopilot.ts for the rules.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, Bot, CheckCircle2, ExternalLink, Loader2, Play } from "lucide-react";

type Row = { clientId: string; name: string; clientType?: string; planned: number; days: number; inReview: number; approved: number; changes: number; accountsOk: boolean; networks: string[]; reviewUrl: string };
type Status = {
  settings: { enabled: boolean | null; clientIds: string[] | null; postTime: string; autoApproveHours: number; monthDay: number };
  enabled: boolean;
  window: { label: string; first: string | null; last: string | null };
  clients: Row[];
  internal: { id: string; name: string; clientType?: string }[];
};

function useStatus() {
  const [s, setS] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    // v4.59.0 audit: only 401/403 mean "not available"; any other failure is an
    // error the page shows with a Retry button (was an endless spinner).
    try {
      const r = await fetch("/api/publishing/autopilot", { cache: "no-store" });
      if (r.status === 401 || r.status === 403) { setHidden(true); return; }
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) { setS(j.data); setError(null); }
      else setError(j?.error || `Could not load Autopilot (HTTP ${r.status}).`);
    } catch {
      setError("Could not reach the server.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { s, setS, hidden, error, setError, load };
}

export function AutopilotStrip() {
  const { s, hidden } = useStatus();
  if (hidden || !s) return null;
  const planned = s.clients.reduce((a, c) => a + c.planned, 0);
  const total = s.clients.reduce((a, c) => a + c.days, 0);
  return (
    <Link href="/publishing/autopilot" className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm hover:bg-gray-50">
      <Bot size={16} className={s.enabled ? "text-emerald-600" : "text-gray-400"} />
      <b>Autopilot {s.enabled ? "ON" : "OFF"}</b>
      {s.enabled && <span className="text-gray-600">· {s.window.label}: {planned}/{total} days planned for {s.clients.length} internal compan{s.clients.length === 1 ? "y" : "ies"} · one post a day at {s.settings.postTime}</span>}
      <span className="ml-auto text-gray-400">Open →</span>
    </Link>
  );
}

export function AutopilotPage() {
  const { s, setS, hidden, error, setError, load } = useStatus();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/publishing/autopilot", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Could not save.");
      setS(j.data); setMsg("Saved.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); }
    setBusy(false);
  }

  async function runNow() {
    setBusy(true); setMsg("Autopilot is writing… (a few posts per step)");
    try {
      for (let i = 0; i < 80; i++) {
        const r = await fetch("/api/publishing/autopilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
        const j = await r.json();
        if (!j?.success) throw new Error(j?.error || "Autopilot failed.");
        const d = j.data;
        await load();
        if (d.errors?.length) setMsg(d.errors.join(" · "));
        else setMsg(`Written so far this step: ${d.written} · still to write: ${d.remaining}${d.submitted ? ` · ${d.submitted} sent for your approval` : ""}`);
        if (!d.remaining || (!d.written && !d.picturesFixed)) break;
      }
    } catch (e) { setMsg(e instanceof Error ? e.message : "Autopilot failed."); }
    setBusy(false);
  }

  if (hidden) return <p className="text-sm text-gray-500">Autopilot is not available for this account.</p>;
  // v4.59.0 audit: show the load error with a Retry instead of spinning forever.
  if (!s && error) {
    return (
      <div className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800 flex items-center gap-3">
        <span>{error}</span>
        <button onClick={() => { setError(null); void load(); }} className="ml-auto px-3 py-1 text-sm font-medium text-red-800 bg-white border border-red-200 rounded-lg">Retry</button>
      </div>
    );
  }
  if (!s) return <Loader2 className="animate-spin text-gray-400" />;
  const chosen = new Set(s.settings.clientIds ?? s.internal.filter((c) => (c.clientType || "INTERNAL") === "INTERNAL").map((c) => c.id));

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <Bot size={22} className={s.enabled ? "text-emerald-600" : "text-gray-400"} />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Autopilot is {s.enabled ? "ON" : "OFF"}</h2>
            <p className="text-sm text-gray-600">
              One post per day for each company you put on Autopilot (internal or campaign). On the {s.settings.monthDay}th, the whole next month is written (LinkedIn + X + picture) from each
              company&apos;s <Link href="/knowledge-base" className="underline">Knowledge Base</Link> and sent to you in one email. Unanswered posts are approved after {s.settings.autoApproveHours}h and published at {s.settings.postTime} (New York).
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <button disabled={busy} onClick={() => save({ enabled: !s.enabled })} className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${s.enabled ? "border-gray-300 bg-white text-gray-700" : "border-emerald-600 bg-emerald-600 text-white"}`}>
              {s.enabled ? "Turn off" : "Turn on"}
            </button>
            <button disabled={busy || !s.enabled} onClick={runNow} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run now
            </button>
          </div>
        </div>
        {msg && <p className="mt-3 text-sm text-gray-700">{msg}</p>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="font-semibold text-gray-900 mb-1">{s.window.label}</h3>
        <p className="text-xs text-gray-500 mb-3">{s.window.first} → {s.window.last}</p>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr><th className="py-1">Company</th><th>Planned</th><th>With you</th><th>Approved</th><th>Changes</th><th>Accounts</th><th></th></tr>
          </thead>
          <tbody>
            {s.clients.map((c) => (
              <tr key={c.clientId} className="border-t border-gray-100">
                <td className="py-2 font-medium">{c.name}{c.clientType === "CAMPAIGN" && <span className="ml-2 text-[10px] font-semibold uppercase text-violet-700 bg-violet-50 border border-violet-100 rounded px-1">Campaign</span>}</td>
                <td>
                  {c.planned >= c.days ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={14} /> {c.planned}/{c.days}</span> : <span className="text-amber-700">{c.planned}/{c.days}</span>}
                </td>
                <td>{c.inReview}</td>
                <td>{c.approved}</td>
                <td>{c.changes}</td>
                <td>
                  {c.accountsOk ? <CheckCircle2 size={14} className="text-emerald-600" /> : c.networks.length ? (
                    <Link href="/publishing/accounts" className="inline-flex items-center gap-1 text-amber-700" title="Posts go only where an account is set"><AlertTriangle size={14} /> {c.networks.join(" + ")} only</Link>
                  ) : <Link href="/publishing/accounts" className="inline-flex items-center gap-1 text-red-700"><AlertTriangle size={14} /> set LinkedIn/X</Link>}
                </td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`/knowledge-base?c=${c.clientId}`} className="inline-flex items-center gap-1 text-gray-600 mr-3"><BookOpen size={13} /> KB</Link>
                  <a href={c.reviewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-600"><ExternalLink size={13} /> Review</a>
                </td>
              </tr>
            ))}
            {!s.clients.length && <tr><td colSpan={7} className="py-3 text-gray-500">No company on Autopilot yet — tick one under Settings.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h3 className="font-semibold text-gray-900">Settings</h3>
        <div>
          <div className="text-sm text-gray-700 mb-1">Companies on Autopilot</div>
          {(["INTERNAL", "CAMPAIGN"] as const).map((type) => {
            const list = s.internal.filter((c) => (c.clientType || "INTERNAL") === type);
            return (
              <div key={type} className="mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  {type === "INTERNAL" ? "Internal" : "Campaign"}
                  <span className="ml-2 normal-case font-normal tracking-normal text-gray-400">
                    {type === "INTERNAL" ? `auto-approved after ${s.settings.autoApproveHours}h` : "the client always approves — never auto-approved"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {list.map((c) => (
                    <label key={c.id} className={`inline-flex items-center gap-1.5 text-sm border rounded-lg px-2 py-1 ${chosen.has(c.id) ? "border-emerald-300 bg-emerald-50" : "border-gray-200"}`}>
                      <input
                        type="checkbox"
                        checked={chosen.has(c.id)}
                        disabled={busy}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(c.id); else next.delete(c.id);
                          void save({ clientIds: Array.from(next) });
                        }}
                      />
                      {c.name}
                    </label>
                  ))}
                  {!list.length && <span className="text-sm text-gray-400">No {type === "INTERNAL" ? "internal" : "campaign"} companies.</span>}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-gray-500">Tick a company to add it: its next month is written on the {s.settings.monthDay}th (or press Run now). Its LinkedIn/X go in <Link href="/publishing/accounts" className="underline">Publishing → Accounts</Link>.</p>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label>Post time (New York){" "}
            <input type="time" defaultValue={s.settings.postTime} onBlur={(e) => e.target.value !== s.settings.postTime && save({ postTime: e.target.value })} className="border border-gray-300 rounded px-2 py-1 ml-1" />
          </label>
          <label>Auto-approve after{" "}
            <input type="number" min={1} max={240} defaultValue={s.settings.autoApproveHours} onBlur={(e) => Number(e.target.value) !== s.settings.autoApproveHours && save({ autoApproveHours: Number(e.target.value) })} className="border border-gray-300 rounded px-2 py-1 w-20 ml-1" /> h
          </label>
          <label>Next month ready on day{" "}
            <input type="number" min={1} max={28} defaultValue={s.settings.monthDay} onBlur={(e) => Number(e.target.value) !== s.settings.monthDay && save({ monthDay: Number(e.target.value) })} className="border border-gray-300 rounded px-2 py-1 w-16 ml-1" />
          </label>
        </div>
      </section>
    </div>
  );
}
