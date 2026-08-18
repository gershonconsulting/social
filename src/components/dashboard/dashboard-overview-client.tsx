"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Flame,
  Heart,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import type { OverviewData, OverviewRow } from "./dashboard-overview";
import { matchesCategory, matchesNetwork, useViewFilters } from "@/lib/view-filters";

interface CompanyRef { id: string; name: string; value: number; sub?: string; }

interface DayBucket { date: string; total: number; byPlatform: Record<string, number>; }
interface AnalyticsSummary {
  days: number;
  totals: { posts: number; likes: number; comments: number; shares: number; engagement: number };
  postsByDay: DayBucket[];
  byPlatform: Record<string, { posts: number; likes: number; comments: number; shares: number }>;
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn", TWITTER: "X / Twitter", GOOGLE_BUSINESS: "Google Business",
};
const PLATFORM_COLOR: Record<string, string> = {
  LINKEDIN: "bg-blue-500", TWITTER: "bg-gray-700", GOOGLE_BUSINESS: "bg-green-600",
};
const RANGE_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}
function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function computeInsights(rows: OverviewRow[]) {
  let silent = 0, quiet = 0, active = 0;
  const silentCompanies: CompanyRef[] = [];
  for (const r of rows) {
    if (r.daysSince > 30) {
      silent++;
      silentCompanies.push({
        id: r.id, name: r.name,
        value: r.daysSince,
        sub: r.daysSince >= 999999 ? "never posted" : `${r.daysSince} days silent`,
      });
    } else if (r.daysSince > 14) quiet++;
    else active++;
  }
  silentCompanies.sort((a, b) => b.value - a.value);

  const movers: CompanyRef[] = rows
    .map((r) => ({ id: r.id, name: r.name, delta: r.postsThisMonth - r.postsLastMonth, tm: r.postsThisMonth, lm: r.postsLastMonth }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5)
    .map((m) => ({ id: m.id, name: m.name, value: m.delta, sub: `${m.delta > 0 ? "+" : ""}${m.delta} vs last month (${m.lm}→${m.tm})` }));

  const mostActive: CompanyRef[] = rows
    .filter((r) => r.postsLastWeek > 0)
    .sort((a, b) => b.postsLastWeek - a.postsLastWeek)
    .slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, value: r.postsLastWeek, sub: `${r.postsLastWeek} posts` }));

  const engagementLeaders: CompanyRef[] = rows
    .filter((r) => r.engThisMonth > 0)
    .sort((a, b) => b.engThisMonth - a.engThisMonth)
    .slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, value: r.engThisMonth, sub: `${r.engThisMonth.toLocaleString()} this month` }));

  return {
    total: rows.length,
    silentCount: silent, quietCount: quiet, activeCount: active,
    silentCompanies: silentCompanies.slice(0, 6),
    movers, mostActive, engagementLeaders,
  };
}

export function DashboardOverviewClient({ data }: { data: OverviewData }) {
  const [days, setDays] = useState(30);
  // Category / network come from the left menu (see FilterPanel) — one shared
  // filter state across the dashboard views instead of a per-page tab strip.
  const { categories, networks } = useViewFilters();
  const [chart, setChart] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Human label for whatever the sidebar filter currently selects.
  const categoryLabel = useMemo(() => {
    if (categories.length === 0) return "All";
    if (categories.length === 1) return categories[0].charAt(0) + categories[0].slice(1).toLowerCase();
    return `${categories.length} categories`;
  }, [categories]);

  const rows = useMemo(
    () => data.rows.filter((r) => matchesCategory(r.clientType, categories) && matchesNetwork(r.platforms, networks)),
    [data.rows, categories, networks]
  );
  const insights = useMemo(() => computeInsights(rows), [rows]);

  // Collection health, scoped to the same filters.
  const coll = useMemo(() => {
    const conns = data.conns.filter(
      (c) => matchesCategory(c.clientType, categories) && matchesNetwork([c.platform], networks),
    );
    const c = { collected: 0, empty: 0, failed: 0, stale: 0, total: conns.length };
    for (const cn of conns) c[cn.state]++;
    return c;
  }, [data.conns, categories, networks]);
  const collPct = coll.total > 0 ? Math.round((100 * coll.collected) / coll.total) : 0;
  const collectionHealthy = coll.failed === 0 && coll.stale === 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      let lastErr = "";
      for (let i = 0; i < 3; i++) {
        try {
          const qs = new URLSearchParams({ days: String(days) });
          // The trends API filters by a single clientType; pass it only when the
          // selection is unambiguous, otherwise the chart stays portfolio-wide.
          if (categories.length === 1) qs.set("clientType", categories[0]);
          const r = await fetch(`/api/analytics/summary?${qs.toString()}`, { cache: "no-store" });
          if (!r.ok) {
            let body: { error?: string } | null = null;
            try { body = await r.json(); } catch {}
            lastErr = body?.error || `HTTP ${r.status}`;
          } else {
            const j = await r.json();
            if (!cancelled) { setChart(j?.data ?? null); setLoading(false); }
            return;
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : "Network error";
        }
        await new Promise((res) => setTimeout(res, 250 * (i + 1)));
      }
      if (!cancelled) { setError(lastErr || "Could not load trends"); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [days, categories, attempt]);

  const maxDay = useMemo(() => {
    if (!chart) return 1;
    return Math.max(1, ...chart.postsByDay.map((d) => d.total));
  }, [chart]);

  const freshDays = data.lastUpdate
    ? Math.max(0, Math.floor((Date.now() - new Date(data.lastUpdate).getTime()) / 86400000))
    : null;
  const freshTone = freshDays === null || freshDays >= 7 ? "stale" : freshDays >= 2 ? "ageing" : "fresh";

  return (
    <div className="space-y-8">
      {/* Data freshness — first thing on the page: is what follows current? */}
      <div
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 border rounded-lg px-4 py-2.5 text-sm ${
          freshTone === "fresh"
            ? "bg-green-50 border-green-200 text-green-800"
            : freshTone === "ageing"
            ? "bg-amber-50 border-amber-200 text-amber-900"
            : "bg-red-50 border-red-300 text-red-800"
        }`}
      >
        {freshTone === "fresh" ? <Clock size={15} /> : <AlertTriangle size={15} />}
        <span className="font-semibold">
          {data.lastUpdate ? `Data updated ${relTime(data.lastUpdate)}` : "No collection has ever run"}
        </span>
        {data.lastUpdate && (
          <span className="opacity-80">
            · last collection {new Date(data.lastUpdate).toLocaleString("en-US", {
              month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
            })}
          </span>
        )}
        {freshDays !== null && freshDays > 0 && (
          <span className="font-semibold">· {freshDays} day{freshDays === 1 ? "" : "s"} old</span>
        )}
        {freshTone === "stale" && <span className="font-semibold">— figures below are out of date, run a sync.</span>}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            What needs your attention today, with portfolio trends below
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
            title="Trend window"
          >
            {RANGE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Category / month / network moved to the left menu (FilterPanel) —
          the page was carrying too many controls. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 border-b border-gray-200 pb-3">
        <span className="font-semibold text-gray-700">Showing {rows.length} of {data.rows.length} companies</span>
        <span className="text-gray-300">·</span>
        <span className="inline-flex items-center bg-white border border-gray-200 rounded-full px-2.5 py-1 font-medium text-gray-700">{categoryLabel}</span>
        <span className="inline-flex items-center bg-white border border-gray-200 rounded-full px-2.5 py-1 font-medium text-gray-700">
          {networks.length === 0 ? "all networks" : `${networks.length} network${networks.length === 1 ? "" : "s"}`}
        </span>
        <span className="text-gray-400">— change these in the left menu under <b className="font-semibold text-gray-500">Filter view</b>.</span>
      </div>

      {/* ===== INSIGHTS / ATTENTION FEED ===== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Collection health */}
        <div className={`rounded-xl border p-5 ${collectionHealthy ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}`}>
          <div className="flex items-center gap-2">
            {collectionHealthy ? <CheckCircle2 size={18} className="text-green-600" /> : <AlertTriangle size={18} className="text-red-600" />}
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Collection health</span>
          </div>
          <div className="mt-2 text-3xl font-bold text-gray-900">
            {coll.collected}<span className="text-lg text-gray-400 font-normal"> / {coll.total}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">platforms collected on the last run ({collPct}%)</div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {coll.failed > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                <XCircle size={11} /> {coll.failed} failed
              </span>
            )}
            {coll.stale > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                <Clock size={11} /> {coll.stale} stale
              </span>
            )}
            {collectionHealthy && coll.total > 0 && (
              <span className="text-[11px] text-green-700 font-medium">All configured platforms fresh</span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">Updated {relTime(data.lastUpdate)}</span>
            <Link href="/networks" className="text-xs font-medium text-red-600 hover:underline inline-flex items-center gap-0.5">
              Networks <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        {/* Silent companies */}
        <div className={`rounded-xl border p-5 ${insights.silentCount > 0 ? "border-amber-200 bg-amber-50/50" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className={insights.silentCount > 0 ? "text-amber-600" : "text-gray-400"} />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Gone silent</span>
          </div>
          <div className="mt-2 text-3xl font-bold text-gray-900">{insights.silentCount}</div>
          <div className="text-xs text-gray-500 mt-0.5">companies with no post in 30+ days</div>
          <div className="mt-3 space-y-1">
            {insights.silentCompanies.length === 0 && (
              <div className="text-xs text-green-700 font-medium">Everyone posted in the last 30 days.</div>
            )}
            {insights.silentCompanies.slice(0, 4).map((c) => (
              <Link key={c.id} href={`/clients/${c.id}`} className="flex items-center justify-between text-xs group">
                <span className="text-gray-700 group-hover:text-red-600 truncate pr-2">{c.name}</span>
                <span className="text-gray-400 whitespace-nowrap">{c.sub}</span>
              </Link>
            ))}
          </div>
          {insights.silentCount > 4 && (
            <div className="mt-2">
              <Link href="/summary" className="text-xs font-medium text-red-600 hover:underline inline-flex items-center gap-0.5">
                See all in Summary <ArrowRight size={11} />
              </Link>
            </div>
          )}
        </div>

        {/* Cadence mix */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-indigo-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Posting cadence</span>
          </div>
          <div className="mt-2 text-3xl font-bold text-gray-900">{insights.total}</div>
          <div className="text-xs text-gray-500 mt-0.5">companies {categories.length === 0 ? "tracked" : "in this group"}</div>
          <div className="mt-3 space-y-2">
            <CadenceBar label="Active (≤14d)" value={insights.activeCount} total={insights.total} color="bg-green-500" />
            <CadenceBar label="Quiet (15–30d)" value={insights.quietCount} total={insights.total} color="bg-amber-500" />
            <CadenceBar label="Silent (30d+)" value={insights.silentCount} total={insights.total} color="bg-red-500" />
          </div>
        </div>
      </div>

      {/* Movers + Most active + Engagement */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <InsightList title="Biggest movers" subtitle="Post volume vs last month" icon={<TrendingUp size={16} className="text-gray-500" />}
          items={insights.movers} empty="No month-over-month change yet."
          render={(c) => (
            <span className={`inline-flex items-center gap-0.5 font-semibold ${c.value > 0 ? "text-green-600" : "text-red-600"}`}>
              {c.value > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{c.value > 0 ? "+" : ""}{c.value}
            </span>
          )} />
        <InsightList title="Most active this week" subtitle="Posts in the last 7 days" icon={<Flame size={16} className="text-orange-500" />}
          items={insights.mostActive} empty="No posts in the last 7 days."
          render={(c) => <span className="font-semibold text-gray-900">{c.value}</span>} />
        <InsightList title="Engagement leaders" subtitle="Likes + comments + shares this month" icon={<Heart size={16} className="text-red-400" />}
          items={insights.engagementLeaders} empty="No engagement recorded this month."
          render={(c) => <span className="font-semibold text-gray-900">{fmt(c.value)}</span>} />
      </div>

      {/* ===== PORTFOLIO TREND CHARTS ===== */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <BarChart3 size={16} className="text-gray-500" />
          {categories.length === 0 ? "Portfolio trends" : `${categoryLabel} trends`} · {RANGE_OPTIONS.find((r) => r.value === days)?.label}
        </h2>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
            <Loader2 size={16} className="animate-spin" /> Loading trends…
          </div>
        )}

        {!loading && error && (
          <div className="p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={20} className="mx-auto text-amber-600 mb-2" />
            <div className="text-sm font-semibold text-amber-900">Could not load trends</div>
            <div className="text-xs text-amber-800 mt-1">{error}</div>
            <button onClick={() => setAttempt((a) => a + 1)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {!loading && !error && chart && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <KpiCard label="Posts" value={fmt(chart.totals.posts)} />
              <KpiCard label="Likes" value={fmt(chart.totals.likes)} />
              <KpiCard label="Comments" value={fmt(chart.totals.comments)} />
              <KpiCard label="Shares" value={fmt(chart.totals.shares)} />
              <KpiCard label="Engagement" value={fmt(chart.totals.engagement)} highlight />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Posts per day</h3>
              {chart.postsByDay.length === 0 || chart.totals.posts === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No posts in this window.</div>
              ) : (
                <>
                  <div className="flex items-end gap-1 h-40">
                    {chart.postsByDay.map((d) => (
                      <div key={d.date} className="flex-1 flex flex-col justify-end group relative" title={`${d.date}: ${d.total} posts`}>
                        <div className="bg-red-500 hover:bg-red-600 transition-colors rounded-t"
                          style={{ height: `${(d.total / maxDay) * 100}%`, minHeight: d.total ? 2 : 0 }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 mt-2 font-mono">
                    <span>{chart.postsByDay[0]?.date ?? ""}</span>
                    <span>{chart.postsByDay[chart.postsByDay.length - 1]?.date ?? ""}</span>
                  </div>
                </>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">By platform</h3>
              {Object.keys(chart.byPlatform).length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No platform data.</div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(chart.byPlatform).sort((a, b) => b[1].posts - a[1].posts).map(([platform, t]) => {
                    const totalEng = t.likes + t.comments + t.shares;
                    const pct = chart.totals.posts > 0 ? Math.round((100 * t.posts) / chart.totals.posts) : 0;
                    return (
                      <div key={platform}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium text-gray-700">
                            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${PLATFORM_COLOR[platform] ?? "bg-gray-400"}`} />
                            {PLATFORM_LABELS[platform] ?? platform}
                          </span>
                          <span className="text-gray-500">{t.posts} posts · {fmt(totalEng)} engagement</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${PLATFORM_COLOR[platform] ?? "bg-gray-400"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CadenceBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((100 * value) / total) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-700">{value}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function InsightList({
  title, subtitle, icon, items, empty, render,
}: {
  title: string; subtitle: string; icon: React.ReactNode;
  items: CompanyRef[]; empty: string; render: (c: CompanyRef) => React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2">{icon}<span className="text-sm font-semibold text-gray-900">{title}</span></div>
      <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>
      <div className="mt-3 divide-y divide-gray-50">
        {items.length === 0 && <div className="text-xs text-gray-400 py-2">{empty}</div>}
        {items.map((c) => (
          <Link key={c.id} href={`/clients/${c.id}`} className="flex items-center justify-between py-2 group">
            <div className="min-w-0 pr-2">
              <div className="text-sm text-gray-800 group-hover:text-red-600 truncate">{c.name}</div>
              {c.sub && <div className="text-[11px] text-gray-400 truncate">{c.sub}</div>}
            </div>
            <div className="text-sm whitespace-nowrap">{render(c)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function KpiCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border p-4 ${highlight ? "border-red-300 ring-1 ring-red-100" : "border-gray-200"}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? "text-red-700" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}
