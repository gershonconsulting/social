"use client";

import { Header } from "@/components/layout/header";
import {
  MONTHLY, SNAPSHOT_AT, FUNNEL_COLORS,
  clientMonth, fmtMonth, workingDays, focusMonths, isFutureMonth, isStale, clientTarget, WEEKLY_CADENCE, type Funnel,
} from "@/lib/heropost-data";

const C = FUNNEL_COLORS;

export function ByHeroPostClient() {
  // Rolling window anchored to today: last month · this month · next month.
  const { lastM, thisM, nextM } = focusMonths();
  const months = [lastM, thisM, nextM];
  const snapLabel = new Date(SNAPSHOT_AT).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const subtitle = `${fmtMonth(lastM)} · ${fmtMonth(thisM)} · ${fmtMonth(nextM)} · created → validated → scheduled → published · data as of ${snapLabel}`;
  const wd = Object.fromEntries(months.map((m) => [m, workingDays(m)])) as Record<string, { target: number; current: boolean }>;
  const staleMonths = months.filter(isStale);

  const hasHistory = (n: string) => Object.values(MONTHLY[n] ?? {}).some((f) => f.some(Boolean));
  const inWindow = Object.keys(MONTHLY).filter((n) => months.some((m) => clientMonth(n, m).some(Boolean)));
  // If the snapshot doesn't reach this window yet, still list every active workspace
  // (at 0%) instead of rendering an empty page.
  const names = (inWindow.length ? inWindow : Object.keys(MONTHLY).filter(hasHistory))
    .sort((a, b) => clientMonth(b, thisM)[1] + clientMonth(b, lastM)[1] - clientMonth(a, thisM)[1] - clientMonth(a, lastM)[1] || a.localeCompare(b));

  return (
    <div>
      <Header title="By HeroPost" subtitle={subtitle} />

      {staleMonths.length > 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3.5 mb-4">
          <b>Data not yet refreshed for {staleMonths.map(fmtMonth).join(", ")}.</b> The last HeroPost pull is from {snapLabel}, so
          figures for these months are incomplete (shown as 0 until the next pull).
        </div>
      )}

      <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl p-3.5 shadow-sm mb-5">
        <b className="text-gray-900">Goal: one published post per working day</b> — except clients with a set cadence (<b className="text-gray-900">Wallix: 3/week</b>). Each figure is output ÷ that client&apos;s target for the month. Default targets:{" "}
        <b className="text-gray-900">{fmtMonth(lastM)} {wd[lastM].target}d</b>,{" "}
        <b className="text-gray-900">{fmtMonth(thisM)} {wd[thisM].target}d so far</b>,{" "}
        <b className="text-gray-900">{fmtMonth(nextM)} {wd[nextM].target}d</b>. 100% = on cadence. Next month shows what is already <b className="text-gray-900">scheduled</b> — its planned coverage.
      </div>

      <div className="space-y-5">
        {names.map((n) => (
          <div key={n}>
            <div className="text-sm font-extrabold text-gray-900 mb-2.5 flex items-center gap-2">
              {n}
              {WEEKLY_CADENCE[n] && (
                <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5">{WEEKLY_CADENCE[n]}/week</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {months.map((m) => (
                <TargetBlock key={m} name={n} counts={clientMonth(n, m)} month={m} future={isFutureMonth(m)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-8">
        Source: HeroPost GraphQL API (9 client workspaces). Periodic snapshot (last pull {snapLabel}) — {fmtMonth(thisM)} is month-to-date. Funnel stages:
        <b> Created</b> = all content for the month (incl. drafts), <b>Validated</b> = approved / past draft (scheduled + published),
        <b> Scheduled</b> = queued for a future date, <b>Published</b> = live. Targets are 1 post per working day unless a weekly
        cadence is set (Wallix: 3/week).
      </p>
    </div>
  );
}

function TargetBlock({ name, counts, month, future = false }: { name: string; counts: Funnel; month: string; future?: boolean }) {
  const t = clientTarget(name, month);
  const idle = !counts.some(Boolean);
  const created = counts[0], published = counts[1], scheduled = counts[2];
  const validated = published + scheduled; // approved = everything past the draft stage
  const rows: [string, number, keyof typeof C][] = [
    ["Created", created, "created"],
    ["Validated", validated, "validated"],
  ];
  if (scheduled > 0) rows.push(["Scheduled", scheduled, "scheduled"]);
  rows.push(["Published", published, "published"]);
  const unit = t.perWeek ? `${t.target} posts · ${t.perWeek}/week` : `${t.target} working days`;
  return (
    <div className={"bg-white border border-gray-200 rounded-2xl p-4 shadow-sm " + (idle ? "opacity-60" : "")}>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-bold text-gray-900">{fmtMonth(month)}{future && <span className="ml-2 text-[10px] font-semibold text-sky-600 bg-sky-50 rounded-full px-2 py-0.5 align-middle">planned</span>}</div>
        <div className="text-[11px] text-gray-500">target {unit}{t.current ? " · to-date" : ""}</div>
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
