"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  MONTHLY, LAG, APPROVAL_SRC, SNAPSHOT_AT, PARTIAL_MONTHS, FUNNEL_COLORS,
  overallByMonth, fmtMonth, clientMonth, workingDays, focusMonths, type Funnel,
} from "@/lib/cloudcampaign-data";

const C = FUNNEL_COLORS;
const METRICS = [
  { k: "published" as const, idx: 2, label: "Published", color: C.published },
  { k: "validated" as const, idx: 1, label: "Validated", color: C.validated },
  { k: "created" as const, idx: 0, label: "Created", color: C.created },
];

function snapshotMonths() {
  const d = new Date(SNAPSHOT_AT);
  const thisM = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const lastM = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  return { thisM, lastM };
}

export function ByCloudCampaignClient() {
  const [tab, setTab] = useState<"target" | "clients" | "months">("target");
  const subtitle = `Snapshot ${new Date(SNAPSHOT_AT).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · created → validated → published`;

  return (
    <div>
      <Header title="By Cloud Campaign" subtitle={subtitle} />

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <TabBtn on={tab === "target"} onClick={() => setTab("target")}>Output vs target</TabBtn>
        <TabBtn on={tab === "clients"} onClick={() => setTab("clients")}>By client · last vs this month</TabBtn>
        <TabBtn on={tab === "months"} onClick={() => setTab("months")}>All months · content funnel</TabBtn>
      </div>

      {tab === "target" ? <TargetTab /> : tab === "clients" ? <ClientsTab /> : <MonthsTab />}

      <p className="text-xs text-gray-400 mt-8">
        Source: Cloud Campaign REST API. Periodic snapshot — June is month-to-date. Two workspaces
        (PhiTech, ACG Cybersecurity) have no recent tracked content.
      </p>
    </div>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors " +
        (on ? "border-[#FE1B04] text-[#FE1B04]" : "border-transparent text-gray-500 hover:text-gray-800")
      }
    >
      {children}
    </button>
  );
}

/* ---------------- Tab: output vs target (1 post / working day) ---------------- */
function TargetTab() {
  const { thisM, lastM } = focusMonths();
  const months = [lastM, thisM];
  const target = Object.fromEntries(months.map((m) => [m, workingDays(m)])) as Record<string, { target: number; current: boolean }>;
  const names = Object.keys(MONTHLY)
    .filter((n) => months.some((m) => clientMonth(n, m).some(Boolean)))
    .sort((a, b) => clientMonth(b, thisM)[2] + clientMonth(b, lastM)[2] - clientMonth(a, thisM)[2] - clientMonth(a, lastM)[2]);

  return (
    <div>
      <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm mb-5">
        <b className="text-gray-900">Goal: one published post per working day.</b> Each figure is output ÷ working days that month —{" "}
        <b className="text-gray-900">{fmtMonth(lastM)} = {target[lastM].target} days</b>,{" "}
        <b className="text-gray-900">{fmtMonth(thisM)} = {target[thisM].target} days so far</b> (month-to-date). 100% = on cadence; the grey line marks 100%.
      </div>
      <div className="space-y-5">
        {names.map((n) => (
          <div key={n}>
            <div className="text-sm font-extrabold text-gray-900 mb-2.5">{n}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {months.map((m) => <TargetBlock key={m} counts={clientMonth(n, m)} month={m} t={target[m]} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TargetBlock({ counts, month, t }: { counts: Funnel; month: string; t: { target: number; current: boolean } }) {
  const idle = !counts.some(Boolean);
  const rows: [string, number, keyof typeof C][] = [
    ["Created", counts[0], "created"],
    ["Validated", counts[1], "validated"],
    ["Published", counts[2], "published"],
  ];
  return (
    <div className={"bg-white border border-gray-200 rounded-2xl p-4 shadow-sm " + (idle ? "opacity-60" : "")}>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-bold text-gray-900">{fmtMonth(month)}</div>
        <div className="text-[11px] text-gray-500">target {t.target} working days{t.current ? " · to-date" : ""}</div>
      </div>
      {rows.map(([label, val, key]) => {
        const pct = t.target ? Math.round((val / t.target) * 100) : 0;
        const w = Math.min(pct, 100);
        return (
          <div key={label} className="mb-2.5 last:mb-0">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: C[key] }} />{label}
              </div>
              <div><span className="text-lg font-extrabold" style={{ color: C[key] }}>{pct}%</span>
                <span className="text-[11px] text-gray-500 font-semibold ml-1.5">{val}/{t.target}</span></div>
            </div>
            <div className="relative h-2 rounded bg-gray-100 overflow-hidden">
              <div className="absolute left-0 top-0 h-2 rounded" style={{ width: `${w}%`, background: C[key] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Tab 1: by client, last vs this month ---------------- */
function ClientsTab() {
  const { thisM, lastM } = snapshotMonths();
  const [metric, setMetric] = useState<(typeof METRICS)[number]>(METRICS[0]);

  const names = useMemo(
    () => Object.keys(MONTHLY).filter((n) => clientMonth(n, lastM).some(Boolean) || clientMonth(n, thisM).some(Boolean)),
    [lastM, thisM]
  );

  const totals = (m: string, idx: number) => Object.keys(MONTHLY).reduce((a, n) => a + clientMonth(n, m)[idx], 0);

  const cmpData = names.map((n) => ({
    name: n,
    last: clientMonth(n, lastM)[metric.idx],
    this: clientMonth(n, thisM)[metric.idx],
  }));

  return (
    <div>
      {/* agency summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {METRICS.slice().reverse().map((mm) => {
          const a = totals(lastM, mm.idx), b = totals(thisM, mm.idx), d = b - a;
          const cls = d > 0 ? "text-green-600" : d < 0 ? "text-red-500" : "text-gray-400";
          const arr = d > 0 ? "▲" : d < 0 ? "▼" : "—";
          return (
            <div key={mm.k} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: mm.color }} />{mm.label}
              </div>
              <div className="flex items-baseline gap-3 mt-2">
                <div className="text-3xl font-extrabold" style={{ color: mm.color }}>{b}</div>
                <div className="text-xs text-gray-500 leading-tight">this month<br />vs <b className="text-gray-800">{a}</b> last month</div>
              </div>
              <div className={"text-xs font-bold mt-1.5 " + cls}>{arr} {d > 0 ? "+" : ""}{d} vs {fmtMonth(lastM)}</div>
            </div>
          );
        })}
      </div>

      {/* comparison chart */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm mb-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Per-client comparison</h2>
            <p className="text-xs text-gray-500">{fmtMonth(lastM)} vs {fmtMonth(thisM)}</p>
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {METRICS.map((mm) => (
              <button key={mm.k} onClick={() => setMetric(mm)}
                className={"px-3 py-1.5 text-xs font-medium " + (metric.k === mm.k ? "bg-[#FE1B04] text-white" : "bg-gray-50 text-gray-500 hover:text-gray-800")}>
                {mm.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cmpData} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f7" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="last" name={fmtMonth(lastM)} fill="#c7cbe6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="this" name={fmtMonth(thisM)} fill={metric.color} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* per-client cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {names.sort((a, b) => clientMonth(b, thisM)[2] + clientMonth(b, lastM)[2] - clientMonth(a, thisM)[2] - clientMonth(a, lastM)[2]).map((n) => (
          <ClientCard key={n} name={n} lastM={lastM} thisM={thisM} />
        ))}
      </div>
    </div>
  );
}

function ClientCard({ name, lastM, thisM }: { name: string; lastM: string; thisM: string }) {
  const fr = (f: Funnel) => (
    <div className="flex gap-1.5">
      {[["Created", f[0], C.created], ["Validated", f[1], C.validated], ["Published", f[2], C.published]].map(([t, n, col]) => (
        <div key={t as string} className="flex-1 bg-gray-50 border border-gray-200 rounded-lg py-1.5 text-center">
          <div className="text-lg font-extrabold leading-none" style={{ color: col as string }}>{n as number}</div>
          <div className="text-[9px] uppercase tracking-wide text-gray-500 mt-1">{t as string}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="text-sm font-bold text-gray-900 mb-3">{name}</div>
      <div className="grid grid-cols-[34px_1fr] gap-y-2 gap-x-2.5 items-center">
        <div className="text-xs font-bold text-gray-500">{fmtMonth(lastM).split(" ")[0]}</div>{fr(clientMonth(name, lastM))}
        <div className="text-xs font-bold text-gray-500">{fmtMonth(thisM).split(" ")[0]}</div>{fr(clientMonth(name, thisM))}
      </div>
    </div>
  );
}

/* ---------------- Tab 2: all months funnel ---------------- */
function MonthsTab() {
  const [ws, setWs] = useState("__all__");
  const rows = useMemo(() => overallByMonth(ws).map((r) => ({ ...r, label: fmtMonth(r.month), partial: PARTIAL_MONTHS.includes(r.month) })), [ws]);
  const tot = rows.reduce((a, r) => ({ c: a.c + r.created, v: a.v + r.validated, p: a.p + r.published, s: a.s + r.scheduled }), { c: 0, v: 0, p: 0, s: 0 });
  const lagTot = Object.values(LAG).reduce((a, b) => a + b, 0);
  const within7 = Math.round(((LAG.same + LAG.d1_7) / lagTot) * 100);

  const kpis = [
    { label: "Created", val: tot.c, color: C.created },
    { label: "Validated", val: tot.v, color: C.validated },
    { label: "Published", val: tot.p, color: C.published },
    { label: "Scheduled ahead", val: tot.s, color: C.scheduled },
  ];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
          {kpis.map((k) => (
            <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
              <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: k.color }} />{k.label}
              </div>
              <div className="text-2xl font-extrabold mt-1" style={{ color: k.color }}>{k.val}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Monthly content funnel</h2>
            <p className="text-xs text-gray-500">Counted by the month each event happened. Validation typically lags creation by 8–30 days ({within7}% approved within a week).</p>
          </div>
          <select value={ws} onChange={(e) => setWs(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-gray-50">
            <option value="__all__">All workspaces</option>
            {Object.keys(MONTHLY).filter((n) => Object.keys(MONTHLY[n]).length).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ height: 340 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={54} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="created" name="Created" fill={C.created} radius={[3, 3, 0, 0]} />
              <Bar dataKey="validated" name="Validated" fill={C.validated} radius={[3, 3, 0, 0]} />
              <Bar dataKey="published" name="Published" fill={C.published} radius={[3, 3, 0, 0]} />
              <Bar dataKey="scheduled" name="Scheduled" fill={C.scheduled} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Validation lag</h2>
          <p className="text-xs text-gray-500 mb-3">Time from created to validated — the real bottleneck.</p>
          {[["Same day", LAG.same, "#10b981"], ["1–7 days", LAG.d1_7, "#34d399"], ["8–30 days", LAG.d8_30, "#6366f1"], ["31–60 days", LAG.d31_60, "#f59e0b"], ["60+ days", LAG.d60p, "#ef4444"]].map(([t, n, col]) => (
            <div key={t as string} className="flex items-center gap-2 mb-1.5">
              <div className="w-20 text-xs text-gray-500">{t as string}</div>
              <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
                <div className="h-3 rounded" style={{ width: `${((n as number) / lagTot) * 100}%`, background: col as string }} />
              </div>
              <div className="w-8 text-xs text-right font-semibold text-gray-700">{n as number}</div>
            </div>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Approvals &amp; platform</h2>
          <p className="text-xs text-gray-500 mb-3">Across all tracked content.</p>
          <div className="space-y-3 text-sm">
            <Stat label="Approved by client" val={APPROVAL_SRC.Client} total={APPROVAL_SRC.Client + APPROVAL_SRC.Internal} color="#10b981" />
            <Stat label="Approved internally" val={APPROVAL_SRC.Internal} total={APPROVAL_SRC.Client + APPROVAL_SRC.Internal} color="#c7cbe6" />
            <div className="pt-2 text-xs text-gray-500">Published platform: <span className="font-semibold text-gray-800">100% LinkedIn</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, val, total, color }: { label: string; val: number; total: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1"><span className="text-gray-600">{label}</span><span className="font-semibold text-gray-800">{val} ({Math.round((val / total) * 100)}%)</span></div>
      <div className="bg-gray-100 rounded h-2.5 overflow-hidden"><div className="h-2.5 rounded" style={{ width: `${(val / total) * 100}%`, background: color }} /></div>
    </div>
  );
}
