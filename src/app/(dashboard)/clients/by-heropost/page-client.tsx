"use client";

import { Header } from "@/components/layout/header";
import {
  MONTHLY, SNAPSHOT_AT, FUNNEL_COLORS,
  clientMonth, fmtMonth, workingDays, focusMonths, isFutureMonth, type Funnel,
} from "@/lib/heropost-data";

const C = FUNNEL_COLORS;

export function ByHeroPostClient() {
  const subtitle = `Snapshot ${new Date(SNAPSHOT_AT).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · created → published → scheduled`;
  const { lastM, thisM, nextM } = focusMonths();
  const months = [lastM, thisM, nextM];
  const target = Object.fromEntries(months.map((m) => [m, workingDays(m)])) as Record<string, { target: number; current: boolean }>;
  const names = Object.keys(MONTHLY)
    .filter((n) => months.some((m) => clientMonth(n, m).some(Boolean)))
    .sort((a, b) => clientMonth(b, thisM)[1] + clientMonth(b, lastM)[1] - clientMonth(a, thisM)[1] - clientMonth(a, lastM)[1]);

  return (
    <div>
      <Header title="By HeroPost" subtitle={subtitle} />

      <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm mb-5">
        <b className="text-gray-900">Goal: one published post per working day.</b> Each figure is output ÷ working days that month —{" "}
        <b className="text-gray-900">{fmtMonth(lastM)} {target[lastM].target}d</b>,{" "}
        <b className="text-gray-900">{fmtMonth(thisM)} {target[thisM].target}d so far</b>,{" "}
        <b className="text-gray-900">{fmtMonth(nextM)} {target[nextM].target}d</b>. 100% = on cadence. Next month shows what is already <b className="text-gray-900">scheduled</b> — its planned coverage.
      </div>

      <div className="space-y-5">
        {names.map((n) => (
          <div key={n}>
            <div className="text-sm font-extrabold text-gray-900 mb-2.5">{n}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {months.map((m) => (
                <TargetBlock key={m} counts={clientMonth(n, m)} month={m} t={target[m]} future={isFutureMonth(m)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-8">
        Source: HeroPost GraphQL API (9 client workspaces). Periodic snapshot — June is month-to-date. HeroPost has no
        created/validated approval step like Cloud Campaign, so the funnel is created → published, plus what is already
        scheduled ahead. EDFLEX North America, Puente Latin and “My Workspace” have no posts in this window.
      </p>
    </div>
  );
}

function TargetBlock({ counts, month, t, future = false }: { counts: Funnel; month: string; t: { target: number; current: boolean }; future?: boolean }) {
  const idle = !counts.some(Boolean);
  const rows: [string, number, keyof typeof C][] = [
    ["Created", counts[0], "created"],
    ["Published", counts[1], "published"],
  ];
  if (counts[2] > 0) rows.push(["Scheduled", counts[2], "scheduled"]);
  return (
    <div className={"bg-white border border-gray-200 rounded-2xl p-4 shadow-sm " + (idle ? "opacity-60" : "")}>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-bold text-gray-900">{fmtMonth(month)}{future && <span className="ml-2 text-[10px] font-semibold text-sky-600 bg-sky-50 rounded-full px-2 py-0.5 align-middle">planned</span>}</div>
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
