"use client";

/**
 * Dashboard — v4.58.0, "Campaign command center".
 *
 * Olivier, 2026-10-21: "Seriously? That's the best dashboard we can do" and
 * "we only care about campaigns". The v4.10 page only said "everything is on
 * track". This one keeps that answer (the health strip) but puts the numbers
 * back, all for CAMPAIGN companies only:
 *
 *   window selector (Last week / Last month / This month / This year / All time)
 *   → health strip (collection · pace · runway · reviews · failed posts)
 *   → 4 KPIs with change vs the previous period and a trend line
 *   → posts per week, 13 weeks, LinkedIn vs X, against the weekly objective
 *   → publishing pipeline + next scheduled posts
 *   → company scoreboard (posts vs objective, trend, engagement, followers
 *     per company — never summed across companies —, content runway, status)
 *   → top posts of the window + data collection detail
 *
 * Hand-drawn SVG only — no charting library on this edge-rendered page.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2, AlertTriangle, XCircle, ArrowUpRight, ArrowDownRight, Minus,
  Heart, MessageCircle, Repeat2, Eye, ExternalLink, CalendarClock,
} from "lucide-react";
import type { DashData, DashCompany } from "./dashboard-overview";

type W = "lw" | "lm" | "tm" | "ty" | "all";
const WINDOWS: { key: W; label: string }[] = [
  { key: "lw", label: "Last week" },
  { key: "lm", label: "Last month" },
  { key: "tm", label: "This month" },
  { key: "ty", label: "This year" },
  { key: "all", label: "All time" },
];

const NET = ["LinkedIn", "X"];
const NET_KEY = ["LINKEDIN", "TWITTER"];
const C_LI = "#0A66C2";
const C_X = "#15171C";
const C_TARGET = "#D92D20";

/* ───────── dates ───────── */
const DAY = 86400000;
const toD = (s: string) => new Date(s + "T00:00:00Z");
const toS = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => toS(new Date(toD(s).getTime() + n * DAY));
const monthKey = (s: string) => s.slice(0, 7);
function addMonths(mk: string, n: number) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const daysInMonth = (mk: string) => {
  const [y, m] = mk.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const diffDays = (a: string, b: string) => Math.round((toD(b).getTime() - toD(a).getTime()) / DAY);

interface Range {
  monthly: boolean;
  from: string; to: string;          // inclusive (days or months)
  prevFrom?: string; prevTo?: string;
  days: number;                       // calendar days covered (for objectives)
  prevLabel: string;
}

function rangeFor(w: W, today: string, firstMonth: string | null): Range {
  const mk = monthKey(today);
  const dom = Number(today.slice(8, 10));
  if (w === "lw") {
    const from = addDays(today, -6);
    return { monthly: false, from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(from, -1), days: 7, prevLabel: "previous 7 days" };
  }
  if (w === "tm") {
    const from = `${mk}-01`;
    const pm = addMonths(mk, -1);
    const pd = Math.min(dom, daysInMonth(pm));
    return { monthly: false, from, to: today, prevFrom: `${pm}-01`, prevTo: `${pm}-${String(pd).padStart(2, "0")}`, days: dom, prevLabel: "same days last month" };
  }
  if (w === "lm") {
    const lm = addMonths(mk, -1);
    const pm = addMonths(mk, -2);
    return {
      monthly: false, from: `${lm}-01`, to: `${lm}-${daysInMonth(lm)}`,
      prevFrom: `${pm}-01`, prevTo: `${pm}-${daysInMonth(pm)}`, days: daysInMonth(lm), prevLabel: "the month before",
    };
  }
  if (w === "ty") {
    const y = Number(today.slice(0, 4));
    return {
      monthly: true, from: `${y}-01`, to: mk, prevFrom: `${y - 1}-01`, prevTo: `${y - 1}-${mk.slice(5)}`,
      days: diffDays(`${y}-01-01`, today) + 1, prevLabel: "same period last year",
    };
  }
  const from = firstMonth ?? mk;
  return { monthly: true, from, to: mk, days: diffDays(`${from}-01`, today) + 1, prevLabel: "" };
}

/* ───────── formatting ───────── */
const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
function relTime(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}
function lastPostLabel(d: number | null): string {
  if (d === null) return "Over a year ago";
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  return `${d} days ago`;
}
const shortDate = (s: string) =>
  toD(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/* ───────── verdicts ───────── */
type Verdict = "silent" | "collection" | "slowing" | "content" | "ok";
const VERDICT: Record<Verdict, { label: string; pill: string; rank: number }> = {
  silent: { label: "Silent", pill: "bg-red-50 text-red-700 ring-1 ring-red-200", rank: 0 },
  collection: { label: "Not collected", pill: "bg-amber-50 text-amber-800 ring-1 ring-amber-200", rank: 1 },
  content: { label: "Low content", pill: "bg-amber-50 text-amber-800 ring-1 ring-amber-200", rank: 2 },
  slowing: { label: "Slowing", pill: "bg-amber-50 text-amber-800 ring-1 ring-amber-200", rank: 3 },
  ok: { label: "On track", pill: "bg-green-50 text-green-800 ring-1 ring-green-200", rank: 4 },
};

interface Stat { posts: number; eng: number; views: number; byNet: [number, number] }
const zero = (): Stat => ({ posts: 0, eng: 0, views: 0, byNet: [0, 0] });

export function DashboardOverviewClient({ data }: { data: DashData }) {
  const [w, setW] = useState<W>("tm");
  const [sort, setSort] = useState<"status" | "posts" | "eng" | "pace">("status");
  const { companies, today } = data;

  const firstMonth = useMemo(
    () => (data.months.length ? data.months.reduce((a, r) => (r[2] < a ? r[2] : a), data.months[0][2]) : null),
    [data.months],
  );
  const range = useMemo(() => rangeFor(w, today, firstMonth), [w, today, firstMonth]);

  const calc = useMemo(() => {
    const cur = companies.map(zero);
    const prev = companies.map(zero);
    const tot = zero();
    const totPrev = zero();
    const add = (s: Stat, net: number, n: number, e: number, v: number) => {
      s.posts += n; s.eng += e; s.views += v; s.byNet[net] += n;
    };
    const rows = range.monthly ? data.months : data.days;
    for (const [c, net, k, n, e, v] of rows) {
      if (k >= range.from && k <= range.to) { add(cur[c], net, n, e, v); add(tot, net, n, e, v); }
      else if (range.prevFrom && k >= range.prevFrom && k <= range.prevTo!) { add(prev[c], net, n, e, v); add(totPrev, net, n, e, v); }
    }

    // Trend series for the KPI sparklines.
    const keys: string[] = [];
    if (range.monthly) { for (let k = range.from; k <= range.to; k = addMonths(k, 1)) keys.push(k); }
    else { for (let k = range.from; k <= range.to; k = addDays(k, 1)) keys.push(k); }
    const pos = new Map(keys.map((k, i) => [k, i]));
    const sp = { posts: keys.map(() => 0), eng: keys.map(() => 0), views: keys.map(() => 0) };
    for (const [, , k, n, e, v] of rows) {
      const i = pos.get(k);
      if (i === undefined) continue;
      sp.posts[i] += n; sp.eng[i] += e; sp.views[i] += v;
    }
    if (!range.monthly) { // cumulative reads better than spiky days
      for (const key of ["posts", "eng", "views"] as const) {
        let acc = 0; sp[key] = sp[key].map((x) => (acc += x));
      }
    }

    // 13 weeks, Monday-based, for the main chart and per-company sparklines.
    const dow = (toD(today).getUTCDay() + 6) % 7;
    const week0 = addDays(today, -dow - 7 * 12);
    const weeks = Array.from({ length: 13 }, (_, i) => addDays(week0, i * 7));
    const wk = weeks.map(() => [0, 0] as [number, number]);
    const cw = companies.map(() => weeks.map(() => 0));
    for (const [c, net, k, n] of data.days) {
      if (k < week0) continue;
      const i = Math.floor(diffDays(week0, k) / 7);
      if (i < 0 || i > 12) continue;
      wk[i][net] += n; cw[c][i] += n;
    }

    return { cur, prev, tot, totPrev, sp, weeks, wk, cw };
  }, [data, companies, range, today]);

  const perWeekTotal = companies.reduce((s, c) => s + c.perWeek, 0);
  const targetPosts = w === "all" ? null : Math.round((perWeekTotal * range.days) / 7);

  /* company rows */
  const broken = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const c of data.collection) {
      if (c.state === "failed" || c.state === "stale") {
        const a = m.get(c.companyIdx) ?? []; a.push(NET[NET_KEY.indexOf(c.platform)] ?? c.platform); m.set(c.companyIdx, a);
      }
    }
    return m;
  }, [data.collection]);

  const rows = companies.map((co, i) => {
    const days = co.lastPost ? diffDays(co.lastPost, today) : null;
    const target = w === "all" ? null : (co.perWeek * range.days) / 7;
    const s = calc.cur[i];
    const pace = target ? s.posts / target : null;
    let verdict: Verdict = "ok";
    let why = "";
    if (days === null || days > 30) { verdict = "silent"; why = days === null ? "No post in over a year" : `No post in ${days} days`; }
    else if (broken.get(i)?.length) { verdict = "collection"; why = `${broken.get(i)!.join(" & ")} not read on last run`; }
    else if (co.runway && co.runway.level === "critical") { verdict = "content"; why = `Only ${co.runway.days} days of approved content`; }
    else if (days > 14) { verdict = "slowing"; why = `Last post ${days} days ago`; }
    else why = pace !== null ? `${Math.round(pace * 100)}% of objective` : `${s.posts} posts`;
    return { co, i, s, prev: calc.prev[i], days, target, pace, verdict, why, weeks: calc.cw[i] };
  });
  rows.sort((a, b) => {
    if (sort === "posts") return b.s.posts - a.s.posts;
    if (sort === "eng") return b.s.eng - a.s.eng;
    if (sort === "pace") return (a.pace ?? 0) - (b.pace ?? 0);
    return VERDICT[a.verdict].rank - VERDICT[b.verdict].rank || (a.pace ?? 0) - (b.pace ?? 0);
  });

  /* health strip */
  const conns = data.collection;
  const collectedOk = conns.filter((c) => c.state === "collected" || c.state === "empty").length;
  const hoursOld = data.lastUpdate ? (Date.now() - new Date(data.lastUpdate).getTime()) / 3_600_000 : Infinity;
  const collectionOk = conns.length > 0 && collectedOk / conns.length >= 0.9 && hoursOld < 30;
  const needs = rows.filter((r) => r.verdict !== "ok");
  const lowRunway = companies.filter((c) => c.runway && c.runway.level !== "ok");
  const pace = targetPosts ? calc.tot.posts / targetPosts : null;

  /* top posts in window */
  const top = useMemo(() => {
    const inWin = (d: string) => (range.monthly ? monthKey(d) >= range.from && monthKey(d) <= range.to : d >= range.from && d <= range.to);
    const seen = new Set<string>();
    return data.top
      .filter((t) => inWin(t.date))
      .filter((t) => { const k = `${t.c}|${t.date}|${t.text.slice(0, 40)}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.likes + b.comments + b.shares - (a.likes + a.comments + a.shares))
      .slice(0, 5);
  }, [data.top, range]);

  const engPerPost = calc.tot.posts ? calc.tot.eng / calc.tot.posts : 0;
  const engPerPostPrev = calc.totPrev.posts ? calc.totPrev.eng / calc.totPrev.posts : 0;
  const hasPrev = !!range.prevFrom;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-red-700 mb-1">Campaigns</div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1">
            {companies.length} campaign companies · {range.monthly ? `${range.from} → ${range.to}` : `${shortDate(range.from)} – ${shortDate(range.to)}`} · data updated {relTime(data.lastUpdate)}
          </p>
        </div>
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
          {WINDOWS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setW(o.key)}
              className={
                "px-3 h-8 whitespace-nowrap text-[13px] font-medium rounded-md transition-colors " +
                (w === o.key ? "bg-red-600 text-white" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50")
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Health strip */}
      <div className="gx-card grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-gray-100 overflow-hidden">
        <Health
          ok={needs.length === 0}
          title={needs.length === 0 ? "All companies on track" : `${needs.length} of ${companies.length} need action`}
          sub={needs.length === 0 ? "No silent or slowing company" : needs.map((n) => n.co.name).join(", ")}
        />
        <Health
          ok={collectionOk}
          title={`Collection ${collectionOk ? "working" : "needs attention"}`}
          sub={`${collectedOk}/${conns.length} networks · ${relTime(data.lastUpdate)}`}
        />
        <Health
          ok={pace === null || pace >= 0.9}
          warn={pace !== null && pace >= 0.7 && pace < 0.9}
          title={pace === null ? `${calc.tot.posts} posts` : `${Math.round(pace * 100)}% of posting objective`}
          sub={targetPosts ? `${calc.tot.posts} of ${targetPosts} posts expected` : "No objective for all time"}
        />
        <Health
          ok={lowRunway.length === 0}
          warn={lowRunway.length > 0 && lowRunway.every((c) => c.runway!.level === "low")}
          title={lowRunway.length === 0 ? "1 week of content ready" : `${lowRunway.length} short on content`}
          sub={lowRunway.length === 0 ? "Every company has 7+ days approved" : lowRunway.map((c) => `${c.name} ${c.runway!.days}d`).join(" · ")}
        />
        <Health
          ok={data.pipeline.failed === 0 && data.pipeline.review === 0}
          warn={data.pipeline.failed === 0 && data.pipeline.review > 0}
          title={data.pipeline.failed ? `${data.pipeline.failed} post${data.pipeline.failed === 1 ? "" : "s"} failed` : `${data.pipeline.review} waiting for client`}
          sub={`${data.pipeline.scheduled} scheduled · ${data.pipeline.published30} published in 30d`}
        />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Posts published"
          value={fmt(calc.tot.posts)}
          cur={calc.tot.posts}
          prev={hasPrev ? calc.totPrev.posts : null}
          prevLabel={range.prevLabel}
          series={calc.sp.posts}
          foot={
            <span className="flex items-center gap-1.5 flex-wrap">
              <Dot c={C_LI} /> LinkedIn {calc.tot.byNet[0]} <span className="w-1" /><Dot c={C_X} /> X {calc.tot.byNet[1]}
            </span>
          }
        />
        <Kpi
          label="Engagement"
          value={fmt(calc.tot.eng)}
          cur={calc.tot.eng}
          prev={hasPrev ? calc.totPrev.eng : null}
          prevLabel={range.prevLabel}
          series={calc.sp.eng}
          foot="Likes + comments + reposts"
        />
        <Kpi
          label="Engagement per post"
          value={engPerPost.toFixed(1)}
          cur={engPerPost}
          prev={hasPrev ? engPerPostPrev : null}
          prevLabel={range.prevLabel}
          foot="Quality of content, not volume"
        />
        <Kpi
          label="Views"
          value={fmt(calc.tot.views)}
          cur={calc.tot.views}
          prev={hasPrev ? calc.totPrev.views : null}
          prevLabel={range.prevLabel}
          series={calc.sp.views}
          foot="Where the network reports them"
        />
      </div>

      {/* Chart + pipeline */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="gx-card p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Posts per week</h2>
              <p className="text-xs text-gray-500 mt-0.5">Last 13 weeks, all campaign companies</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-600">
              <span className="flex items-center gap-1.5"><Dot c={C_LI} /> LinkedIn</span>
              <span className="flex items-center gap-1.5"><Dot c={C_X} /> X</span>
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: C_TARGET }} /> Objective {perWeekTotal}/wk</span>
            </div>
          </div>
          <WeekChart weeks={calc.weeks} data={calc.wk} target={perWeekTotal} />
        </section>

        <section className="gx-card p-5 flex flex-col">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Publishing pipeline</h2>
            <Link href="/publishing" className="text-xs font-medium text-red-700 hover:underline">Open</Link>
          </div>
          <Pipeline p={data.pipeline} />
          <div className="mt-4 pt-4 border-t border-gray-100 flex-1">
            <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5"><CalendarClock size={13} /> Next up</div>
            {data.upcoming.length === 0 ? (
              <div className="text-sm text-gray-500">Nothing scheduled.</div>
            ) : (
              <ul className="space-y-2">
                {data.upcoming.slice(0, 4).map((u, k) => (
                  <li key={k} className="flex gap-2.5 text-sm">
                    <div className="w-12 shrink-0 text-xs text-gray-500 gx-num pt-0.5">
                      {new Date(u.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-900 flex items-center gap-1.5">
                        <Dot c={u.platform === "LINKEDIN" ? C_LI : C_X} /> {companies[u.c]?.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{u.text}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Scoreboard */}
      <section className="gx-card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Company scoreboard</h2>
            <p className="text-xs text-gray-500 mt-0.5">{WINDOWS.find((x) => x.key === w)!.label} · followers are per company, change over 30 days</p>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-500 mr-1">Sort</span>
            {([["status", "Status"], ["pace", "Behind first"], ["posts", "Posts"], ["eng", "Engagement"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSort(k)}
                className={"px-2 h-7 rounded-md font-medium " + (sort === k ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50">
                <th className="px-5 py-2.5 font-medium">Company</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Posts vs objective</th>
                <th className="px-3 py-2.5 font-medium">13 weeks</th>
                <th className="px-3 py-2.5 font-medium text-right">Engagement</th>
                <th className="px-3 py-2.5 font-medium text-right">Per post</th>
                <th className="px-3 py-2.5 font-medium">Followers</th>
                <th className="px-3 py-2.5 font-medium">Content ready</th>
                <th className="px-5 py-2.5 font-medium">Last post</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.co.id} className="border-t border-gray-100 hover:bg-gray-50 align-middle">
                  <td className="px-5 py-3">
                    <Link href={`/clients/${r.co.id}`} className="flex items-center gap-2.5 group">
                      <Logo co={r.co} />
                      <span className="font-medium text-gray-900 group-hover:underline">{r.co.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className={"gx-pill " + VERDICT[r.verdict].pill}>{VERDICT[r.verdict].label}</span>
                    <div className="text-[11px] text-gray-500 mt-1 max-w-[160px] leading-tight">{r.why}</div>
                  </td>
                  <td className="px-3 py-3">
                    <PaceBar posts={r.s.posts} target={r.target} />
                    <div className="text-[11px] text-gray-500 mt-1">
                      LinkedIn {r.s.byNet[0]} · X {r.s.byNet[1]} · {r.co.perWeek}/wk
                    </div>
                  </td>
                  <td className="px-3 py-3"><Spark values={r.weeks} bars /></td>
                  <td className="px-3 py-3 text-right">
                    <div className="gx-num text-gray-900">{fmt(r.s.eng)}</div>
                    {hasPrev && <Delta cur={r.s.eng} prev={r.prev.eng} small />}
                  </td>
                  <td className="px-3 py-3 text-right gx-num text-gray-700">{r.s.posts ? (r.s.eng / r.s.posts).toFixed(1) : "—"}</td>
                  <td className="px-3 py-3">
                    {r.co.followers.length === 0 ? <span className="text-gray-400">—</span> : (
                      <div className="space-y-0.5">
                        {r.co.followers.sort((a, b) => a.platform.localeCompare(b.platform)).map((f) => {
                          const d = f.then !== null ? f.now - f.then : null;
                          return (
                            <div key={f.platform} className="flex items-center gap-1.5 text-xs">
                              <Dot c={f.platform === "LINKEDIN" ? C_LI : C_X} />
                              <span className="gx-num text-gray-900">{fmt(f.now)}</span>
                              {d !== null && d !== 0 && (
                                <span className={"gx-num " + (d > 0 ? "text-green-700" : "text-red-700")}>{d > 0 ? "+" : ""}{fmt(d)}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3"><Runway r={r.co.runway} /></td>
                  <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{lastPostLabel(r.days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top posts + collection */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="gx-card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold text-gray-900">Top posts</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">Most engagement · {WINDOWS.find((x) => x.key === w)!.label.toLowerCase()}</p>
          {top.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">No posts in this period.</div>
          ) : (
            <ol className="divide-y divide-gray-100">
              {top.map((t, k) => (
                <li key={k} className="py-3 flex gap-3">
                  <div className="w-6 shrink-0 gx-num text-lg font-semibold text-gray-300">{k + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Dot c={t.platform === "LINKEDIN" ? C_LI : C_X} />
                      <span className="font-medium text-gray-900">{companies[t.c]?.name}</span>
                      <span>· {shortDate(t.date)}</span>
                      {t.url && (
                        <a href={t.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-red-700 hover:underline">
                          Open <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mt-1 line-clamp-2">{t.text || "(no text)"}</p>
                    <div className="flex gap-4 mt-1.5 text-xs text-gray-500 gx-num">
                      <span className="flex items-center gap-1"><Heart size={12} />{fmt(t.likes)}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={12} />{fmt(t.comments)}</span>
                      <span className="flex items-center gap-1"><Repeat2 size={12} />{fmt(t.shares)}</span>
                      {t.views > 0 && <span className="flex items-center gap-1"><Eye size={12} />{fmt(t.views)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="gx-card p-5">
          <h2 className="text-base font-semibold text-gray-900">Data collection</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-4">Last run {relTime(data.lastUpdate)}</p>
          <div className="flex items-center gap-4 mb-4">
            <Ring value={conns.length ? collectedOk / conns.length : 0} ok={collectionOk} />
            <div>
              <div className="text-2xl font-semibold gx-num text-gray-900">{collectedOk}/{conns.length}</div>
              <div className="text-xs text-gray-500">networks read on the last run</div>
            </div>
          </div>
          <ul className="space-y-1.5">
            {companies.map((co, i) => (
              <li key={co.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 truncate">{co.name}</span>
                <span className="flex gap-1">
                  {[0, 1].map((n) => {
                    const c = conns.find((x) => x.companyIdx === i && x.platform === NET_KEY[n]);
                    if (!c) return <span key={n} className="gx-pill bg-gray-100 text-gray-400">{NET[n]}</span>;
                    const good = c.state === "collected" || c.state === "empty";
                    return (
                      <span key={n} title={c.lastSyncAt ? `Last read ${relTime(c.lastSyncAt)}` : "Never read"}
                        className={"gx-pill " + (good ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700")}>
                        {good ? <CheckCircle2 size={11} /> : <XCircle size={11} />} {NET[n]}
                      </span>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/analytics" className="mt-4 inline-flex text-xs font-medium text-red-700 hover:underline">Deeper trends on Analytics →</Link>
        </section>
      </div>
    </div>
  );
}

/* ───────── pieces ───────── */

function Dot({ c }: { c: string }) {
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: c }} />;
}

function Logo({ co }: { co: DashCompany }) {
  if (co.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={co.logoUrl} alt="" className="w-7 h-7 rounded-md object-contain bg-white border border-gray-200" />;
  }
  return (
    <span className="w-7 h-7 rounded-md bg-gray-900 text-white text-[11px] font-semibold flex items-center justify-center">
      {co.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Health({ ok, warn, title, sub }: { ok: boolean; warn?: boolean; title: string; sub: string }) {
  const tone = ok ? "text-green-700" : warn ? "text-amber-600" : "text-red-700";
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  return (
    <div className="px-4 py-3.5 flex gap-2.5 min-w-0">
      <Icon size={18} className={tone + " shrink-0 mt-0.5"} />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900 leading-snug">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5 truncate" title={sub}>{sub}</div>
      </div>
    </div>
  );
}

function Delta({ cur, prev, small }: { cur: number; prev: number; small?: boolean }) {
  if (!prev && !cur) return <span className="text-xs text-gray-400">—</span>;
  if (!prev) return <span className={"text-green-700 " + (small ? "text-[11px]" : "text-xs")}>new</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  const tone = pct > 0 ? "text-green-700" : pct < 0 ? "text-red-700" : "text-gray-500";
  return (
    <span className={"inline-flex items-center gap-0.5 font-medium gx-num " + tone + (small ? " text-[11px]" : " text-xs")}>
      <Icon size={small ? 11 : 13} />{pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

function Kpi({
  label, value, cur, prev, prevLabel, series, foot,
}: {
  label: string; value: string; cur: number; prev: number | null; prevLabel: string; series?: number[]; foot: React.ReactNode;
}) {
  return (
    <div className="gx-card p-5 flex flex-col">
      <div className="text-[13px] font-medium text-gray-500">{label}</div>
      <div className="flex items-end justify-between gap-2 mt-2">
        <div className="text-[30px] leading-none font-semibold gx-num text-gray-900 whitespace-nowrap">{value}</div>
        {series && series.length > 1 && <Spark values={series} />}
      </div>
      <div className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
        {prev !== null ? (<><Delta cur={cur} prev={prev} /> vs {prevLabel}</>) : <span>&nbsp;</span>}
      </div>
      <div className="mt-auto pt-3 text-xs text-gray-500 border-t border-gray-100 mt-3">{foot}</div>
    </div>
  );
}

function Spark({ values, bars }: { values: number[]; bars?: boolean }) {
  const W = bars ? 92 : 96, H = bars ? 26 : 34;
  const max = Math.max(1, ...values);
  if (bars) {
    const bw = W / values.length;
    return (
      <svg width={W} height={H} className="block" aria-hidden>
        {values.map((v, i) => {
          const h = v ? Math.max(2, (v / max) * H) : 1;
          return <rect key={i} x={i * bw + 1} y={H - h} width={bw - 2} height={h} rx={1}
            fill={i === values.length - 1 ? C_TARGET : v ? "#9A9DA5" : "#E6E3DC"} />;
        })}
      </svg>
    );
  }
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 2 - (v / max) * (H - 4)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return (
    <svg width={W} height={H} className="block shrink-0" aria-hidden>
      <path d={`${d}L${W},${H}L0,${H}Z`} fill="#D92D20" opacity={0.08} />
      <path d={d} fill="none" stroke="#D92D20" strokeWidth={1.75} strokeLinejoin="round" />
    </svg>
  );
}

function WeekChart({ weeks, data, target }: { weeks: string[]; data: [number, number][]; target: number }) {
  const W = 720, H = 230, L = 30, B = 24, T = 10;
  const max = Math.max(target * 1.15, ...data.map((d) => d[0] + d[1]), 1);
  const nice = max <= 10 ? Math.ceil(max) : Math.ceil(max / 5) * 5;
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const slot = (W - L) / weeks.length;
  const bw = Math.min(34, slot * 0.62);
  const ticks = [0, nice / 2, nice].map((v) => Math.round(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-4" role="img" aria-label="Posts per week">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="#E6E3DC" strokeWidth={1} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#9A9DA5">{t}</text>
        </g>
      ))}
      {data.map(([li, x], i) => {
        const cx = L + slot * i + slot / 2;
        const yLi = y(li), yAll = y(li + x);
        const current = i === data.length - 1;
        return (
          <g key={i}>
            <title>{`Week of ${shortDate(weeks[i])}: ${li} LinkedIn, ${x} X${current ? " (in progress)" : ""}`}</title>
            <rect x={cx - bw / 2} y={yLi} width={bw} height={Math.max(0, y(0) - yLi)} fill={C_LI} opacity={current ? 0.55 : 1} />
            <rect x={cx - bw / 2} y={yAll} width={bw} height={Math.max(0, yLi - yAll)} fill={C_X} opacity={current ? 0.55 : 1} />
            {li + x > 0 && (
              <text x={cx} y={yAll - 4} textAnchor="middle" fontSize="10" fill="#50545D" className="gx-num">{li + x}</text>
            )}
            {(i % 2 === 0 || current) && (
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="#9A9DA5">
                {current ? "This wk" : shortDate(weeks[i])}
              </text>
            )}
          </g>
        );
      })}
      {target > 0 && (
        <line x1={L} x2={W} y1={y(target)} y2={y(target)} stroke={C_TARGET} strokeWidth={1.5} strokeDasharray="5 4" />
      )}
    </svg>
  );
}

function Pipeline({ p }: { p: DashData["pipeline"] }) {
  const stages = [
    { label: "Drafts", n: p.drafts, c: "#D4D0C7" },
    { label: "With client", n: p.review, c: "#E65A4B" },
    { label: "Changes asked", n: p.changes, c: "#F59E0B" },
    { label: "Approved", n: p.approved, c: "#86C79A" },
    { label: "Scheduled", n: p.scheduled, c: "#2E7D4F" },
    { label: "Published 30d", n: p.published30, c: "#15171C" },
  ];
  const max = Math.max(1, ...stages.map((s) => s.n));
  return (
    <div className="mt-4 space-y-2">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-2 text-xs">
          <div className="w-24 text-gray-600 shrink-0">{s.label}</div>
          <div className="flex-1 h-4 bg-gray-50 rounded overflow-hidden">
            <div className="h-full rounded" style={{ width: `${(s.n / max) * 100}%`, background: s.c, minWidth: s.n ? 4 : 0 }} />
          </div>
          <div className="w-8 text-right gx-num font-medium text-gray-900">{s.n}</div>
        </div>
      ))}
      {p.failed > 0 && <div className="text-xs font-medium text-red-700 pt-1">{p.failed} failed / missed in the last 30 days</div>}
    </div>
  );
}

function PaceBar({ posts, target }: { posts: number; target: number | null }) {
  if (target === null) return <span className="gx-num text-gray-900 font-medium">{posts}</span>;
  const t = Math.max(1, Math.round(target));
  const pct = posts / t;
  const color = pct >= 0.9 ? "#2E7D4F" : pct >= 0.6 ? "#F59E0B" : "#D92D20";
  return (
    <div className="w-40">
      <div className="flex justify-between text-xs">
        <span className="gx-num font-semibold text-gray-900">{posts}<span className="text-gray-400 font-normal"> / {t}</span></span>
        <span className="gx-num" style={{ color }}>{Math.round(pct * 100)}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Runway({ r }: { r: DashCompany["runway"] }) {
  if (!r) return <span className="text-gray-400">—</span>;
  const color = r.level === "ok" ? "#2E7D4F" : r.level === "low" ? "#F59E0B" : "#D92D20";
  return (
    <div className="w-28">
      <div className="text-xs"><span className="gx-num font-semibold" style={{ color }}>{r.days} days</span> <span className="text-gray-400">/ 7</span></div>
      <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.days / 7) * 100)}%`, background: color }} />
      </div>
      {(r.inReview > 0 || r.changes > 0) && (
        <div className="text-[11px] text-gray-500 mt-1">{r.inReview} with client{r.changes ? ` · ${r.changes} changes` : ""}</div>
      )}
    </div>
  );
}

function Ring({ value, ok }: { value: number; ok: boolean }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" aria-hidden>
      <circle cx={28} cy={28} r={r} fill="none" stroke="#F3F1EC" strokeWidth={6} />
      <circle cx={28} cy={28} r={r} fill="none" stroke={ok ? "#2E7D4F" : "#D92D20"} strokeWidth={6}
        strokeDasharray={`${c * value} ${c}`} strokeLinecap="round" transform="rotate(-90 28 28)" />
    </svg>
  );
}
