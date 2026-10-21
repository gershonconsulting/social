"use client";

/**
 * Dashboard — v4.59.0, campaign objective view.
 *
 * Olivier, 2026-10-21 (2nd pass): "5/5 is my objective, I need to know how far
 * we are from a 100% objective to post daily, including what we have in stock
 * for next month, how successful the posts are, how efficient we are getting
 * during a campaign." The page now answers those four questions, in order.
 *
 * (v4.58.0 notes below.)
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
  CheckCircle2, XCircle, ArrowUpRight, ArrowDownRight, Minus,
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

const shortDate = (s: string) =>
  toD(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/* ───────── objective ───────── */
// Olivier, 2026-10-21: "5/5 is my objective" — one post every weekday, for
// every campaign company. 100% = every Monday–Friday had at least one post.


const isWeekday = (s: string) => {
  const d = toD(s).getUTCDay();
  return d !== 0 && d !== 6;
};
function weekdays(from: string, to: string): number {
  if (to < from) return 0;
  let n = 0;
  for (let k = from; k <= to; k = addDays(k, 1)) if (isWeekday(k)) n++;
  return n;
}
const maxS = (a: string, b: string) => (a > b ? a : b);
const minS = (a: string, b: string) => (a < b ? a : b);
const monthLabel = (mk: string, long = false) =>
  toD(`${mk}-01`).toLocaleDateString("en-US", { month: long ? "long" : "short", year: long ? undefined : "2-digit", timeZone: "UTC" });
const pctTone = (p: number) => (p >= 0.9 ? "#2E7D4F" : p >= 0.6 ? "#F59E0B" : "#D92D20");

interface Cover { days: number; li: number; x: number; due: number }

export function DashboardOverviewClient({ data }: { data: DashData }) {
  const [w, setW] = useState<W>("tm");
  const { companies, today } = data;
  const mk = monthKey(today);
  const nextMk = addMonths(mk, 1);

  const firstMonth = useMemo(
    () => (data.months.length ? data.months.reduce((a, r) => (r[2] < a ? r[2] : a), data.months[0][2]) : null),
    [data.months],
  );
  const range = useMemo(() => rangeFor(w, today, firstMonth), [w, today, firstMonth]);

  /* ── 1. Posting objective: weekdays with a post, per company ── */
  const coverage = useMemo(() => {
    // weekday post dates per company, per network, from the daily rows (400 days)
    const dates = companies.map(() => ({ any: new Set<string>(), li: new Set<string>(), x: new Set<string>() }));
    for (const [c, net, k] of data.days) {
      if (!isWeekday(k)) continue;
      dates[c].any.add(k);
      (net === 0 ? dates[c].li : dates[c].x).add(k);
    }
    const coverByMonth = new Map<string, [number, number, number]>();
    for (const [c, k, a, li, x] of data.cover) coverByMonth.set(`${c}|${k}`, [a, li, x]);

    const forRange = (ci: number, from: string, to: string, monthly: boolean): Cover => {
      const start = companies[ci].campaignStart;
      if (monthly) {
        const f = maxS(`${from}-01`, start ?? `${from}-01`);
        const t = minS(`${to}-${daysInMonth(to)}`, today);
        const due = weekdays(f, t);
        let days = 0, li = 0, x = 0;
        for (let m = monthKey(f); m <= to; m = addMonths(m, 1)) {
          const r = coverByMonth.get(`${ci}|${m}`);
          if (r) { days += r[0]; li += r[1]; x += r[2]; }
        }
        return { days: Math.min(days, due), li: Math.min(li, due), x: Math.min(x, due), due };
      }
      const f = start ? maxS(from, start) : from;
      const t = minS(to, today);
      const due = weekdays(f, t);
      let days = 0, li = 0, x = 0;
      for (let k = f; k <= t; k = addDays(k, 1)) {
        if (dates[ci].any.has(k)) days++;
        if (dates[ci].li.has(k)) li++;
        if (dates[ci].x.has(k)) x++;
      }
      return { days, li, x, due };
    };

    const cur = companies.map((_, i) => forRange(i, range.from, range.to, range.monthly));
    const prev = range.prevFrom ? companies.map((_, i) => forRange(i, range.prevFrom!, range.prevTo!, range.monthly)) : null;
    const sum = (a: Cover[]) => a.reduce((s, c) => ({ days: s.days + c.days, li: s.li + c.li, x: s.x + c.x, due: s.due + c.due }), { days: 0, li: 0, x: 0, due: 0 });

    // last 13 weeks (Mon–Fri), days posted per company
    const dow = (toD(today).getUTCDay() + 6) % 7;
    const week0 = addDays(today, -dow - 7 * 12);
    const weeks = Array.from({ length: 13 }, (_, i) => addDays(week0, i * 7));
    const perWeek = companies.map((_, ci) =>
      weeks.map((wk) => {
        let n = 0;
        for (let d = 0; d < 5; d++) { const k = addDays(wk, d); if (k <= today && dates[ci].any.has(k)) n++; }
        return n;
      }),
    );
    const weekDue = weeks.map((wk) => weekdays(wk, minS(addDays(wk, 4), today)));
    const weekPct = weeks.map((_, i) => {
      const due = weekDue[i] * companies.length;
      return due ? perWeek.reduce((s, r) => s + r[i], 0) / due : 0;
    });

    return { cur, prev, tot: sum(cur), totPrev: prev ? sum(prev) : null, weeks, perWeek, weekPct, weekDue };
  }, [data.days, data.cover, companies, range, today]);

  /* ── 2. Stock: content ready for the rest of this month and next month ── */
  const stock = useMemo(() => {
    const tomorrow = addDays(today, 1);
    const restDue = weekdays(tomorrow, `${mk}-${daysInMonth(mk)}`);
    const nextDue = weekdays(`${nextMk}-01`, `${nextMk}-${daysInMonth(nextMk)}`);
    const READY = new Set(["APPROVED", "SCHEDULED"]);
    const rows = companies.map(() => ({
      restReady: new Set<string>(), nextReady: new Set<string>(),
      nextReview: 0, nextDrafts: 0, undated: 0, undatedOther: 0,
    }));
    for (const [c, status, d] of data.stock) {
      const r = rows[c];
      if (!d) { if (status === "APPROVED") r.undated++; else r.undatedOther++; continue; }
      const inNext = monthKey(d) === nextMk;
      const inRest = d >= tomorrow && monthKey(d) === mk;
      if (READY.has(status)) {
        if (inNext && isWeekday(d)) r.nextReady.add(d);
        if (inRest && isWeekday(d)) r.restReady.add(d);
      } else if (inNext) {
        if (status === "DRAFT") r.nextDrafts++; else r.nextReview++;
      }
    }
    const out = rows.map((r) => ({
      rest: r.restReady.size, next: r.nextReady.size, nextReview: r.nextReview, nextDrafts: r.nextDrafts,
      undated: r.undated, undatedOther: r.undatedOther,
    }));
    const nextReadyTot = out.reduce((s, r) => s + r.next, 0);
    return {
      restDue, nextDue, rows: out,
      nextPct: nextDue && companies.length ? nextReadyTot / (nextDue * companies.length) : 0,
      nextReadyTot,
      nextReviewTot: out.reduce((s, r) => s + r.nextReview, 0),
      nextDraftsTot: out.reduce((s, r) => s + r.nextDrafts, 0),
      undatedTot: out.reduce((s, r) => s + r.undated, 0),
    };
  }, [data.stock, companies, today, mk, nextMk]);

  /* ── 3. Performance in the window ── */
  const perf = useMemo(() => {
    const cur = companies.map(() => ({ posts: 0, eng: 0, views: 0 }));
    const prev = companies.map(() => ({ posts: 0, eng: 0, views: 0 }));
    const rows = range.monthly ? data.months : data.days;
    for (const [c, , k, n, e, v] of rows) {
      const tgt = k >= range.from && k <= range.to ? cur : range.prevFrom && k >= range.prevFrom && k <= range.prevTo! ? prev : null;
      if (tgt) { tgt[c].posts += n; tgt[c].eng += e; tgt[c].views += v; }
    }
    const sum = (a: typeof cur) => a.reduce((s, x) => ({ posts: s.posts + x.posts, eng: s.eng + x.eng, views: s.views + x.views }), { posts: 0, eng: 0, views: 0 });
    return { cur, prev, tot: sum(cur), totPrev: sum(prev) };
  }, [data.days, data.months, companies, range]);

  /* ── 4. Efficiency over the campaign, month by month since it started ── */
  const eff = useMemo(() => {
    const byKey = new Map<string, { n: number; e: number }>();
    for (const [c, , k, n, e] of data.months) {
      const r = byKey.get(`${c}|${k}`) ?? { n: 0, e: 0 };
      r.n += n; r.e += e; byKey.set(`${c}|${k}`, r);
    }
    const coverByMonth = new Map<string, number>();
    for (const [c, k, a] of data.cover) coverByMonth.set(`${c}|${k}`, a);

    const perCo = companies.map((co, ci) => {
      if (!co.campaignStart) return null;
      const startMk = monthKey(co.campaignStart);
      const months: { mk: string; cov: number; epp: number | null; posts: number; full: boolean }[] = [];
      for (let m = startMk; m <= mk; m = addMonths(m, 1)) {
        const f = maxS(`${m}-01`, co.campaignStart);
        const t = minS(`${m}-${daysInMonth(m)}`, today);
        const due = weekdays(f, t);
        const days = coverByMonth.get(`${ci}|${m}`) ?? 0;
        const pe = byKey.get(`${ci}|${m}`);
        months.push({ mk: m, cov: due ? Math.min(1, days / due) : 0, epp: pe && pe.n ? pe.e / pe.n : null, posts: pe?.n ?? 0, full: m < mk });
      }
      const full = months.filter((x) => x.full);
      const avg = (a: typeof months, f: (x: (typeof months)[0]) => number | null) => {
        const v = a.map(f).filter((x): x is number => x !== null);
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      const first = full.slice(0, 3), last = full.slice(-3);
      const enough = full.length >= 4;
      return {
        months: months.slice(-12),
        age: months.length,
        covStart: enough ? avg(first, (x) => x.cov) : null,
        covNow: enough ? avg(last, (x) => x.cov) : null,
        eppStart: enough ? avg(first, (x) => x.epp) : null,
        eppNow: enough ? avg(last, (x) => x.epp) : null,
      };
    });

    // campaign-wide, calendar months (last 12): days-posted % and engagement per post
    const cal: { mk: string; cov: number; epp: number | null }[] = [];
    for (let i = 11; i >= 0; i--) {
      const m = addMonths(mk, -i);
      let days = 0, due = 0, n = 0, e = 0;
      companies.forEach((co, ci) => {
        if (!co.campaignStart || monthKey(co.campaignStart) > m) return;
        const f = maxS(`${m}-01`, co.campaignStart);
        const t = minS(`${m}-${daysInMonth(m)}`, today);
        const d = weekdays(f, t);
        due += d;
        days += Math.min(d, coverByMonth.get(`${ci}|${m}`) ?? 0);
        const pe = byKey.get(`${ci}|${m}`);
        if (pe) { n += pe.n; e += pe.e; }
      });
      if (due) cal.push({ mk: m, cov: days / due, epp: n ? e / n : null });
    }
    const valid = perCo.filter((p): p is NonNullable<typeof p> => !!p && p.eppStart !== null && p.eppNow !== null);
    const eppChange = valid.length
      ? valid.reduce((s, p) => s + (p.eppStart ? (p.eppNow! - p.eppStart) / p.eppStart : 0), 0) / valid.length
      : null;
    const covChange = valid.length ? valid.reduce((s, p) => s + (p.covNow! - p.covStart!), 0) / valid.length : null;
    return { perCo, cal, eppChange, covChange, measured: valid.length };
  }, [data.months, data.cover, companies, mk, today]);

  /* ── order: furthest from the objective first ── */
  const order = companies
    .map((co, i) => ({ co, i, pct: coverage.cur[i].due ? coverage.cur[i].days / coverage.cur[i].due : 0 }))
    .sort((a, b) => a.pct - b.pct);

  const totPct = coverage.tot.due ? coverage.tot.days / coverage.tot.due : 0;
  const prevPct = coverage.totPrev && coverage.totPrev.due ? coverage.totPrev.days / coverage.totPrev.due : null;
  const epp = perf.tot.posts ? perf.tot.eng / perf.tot.posts : 0;
  const eppPrev = perf.totPrev.posts ? perf.totPrev.eng / perf.totPrev.posts : 0;
  const hasPrev = !!range.prevFrom;
  const windowLabel = WINDOWS.find((x) => x.key === w)!.label;

  const conns = data.collection;
  const collectedOk = conns.filter((c) => c.state === "collected" || c.state === "empty").length;
  const hoursOld = data.lastUpdate ? (Date.now() - new Date(data.lastUpdate).getTime()) / 3_600_000 : Infinity;
  const collectionOk = conns.length > 0 && collectedOk / conns.length >= 0.9 && hoursOld < 30;

  const top = useMemo(() => {
    const inWin = (d: string) => (range.monthly ? monthKey(d) >= range.from && monthKey(d) <= range.to : d >= range.from && d <= range.to);
    const seen = new Set<string>();
    return data.top
      .filter((t) => inWin(t.date))
      .filter((t) => { const k = `${t.c}|${t.date}|${t.text.slice(0, 40)}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.likes + b.comments + b.shares - (a.likes + a.comments + a.shares))
      .slice(0, 5);
  }, [data.top, range]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-red-700 mb-1">Campaigns · objective 5 posts a week, every weekday</div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1 flex flex-wrap items-center gap-x-1.5">
            <span>{companies.length} campaign companies · {range.monthly ? `${monthLabel(range.from)} – ${monthLabel(range.to)}` : `${shortDate(range.from)} – ${shortDate(minS(range.to, today))}`}</span>
            <span>·</span>
            <span className={collectionOk ? "" : "text-red-700 font-medium"}>
              data {relTime(data.lastUpdate)} ({collectedOk}/{conns.length} networks read)
            </span>
          </p>
        </div>
        <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
          {WINDOWS.map((o) => (
            <button key={o.key} type="button" onClick={() => setW(o.key)}
              className={"px-3 h-8 whitespace-nowrap text-[13px] font-medium rounded-md transition-colors " +
                (w === o.key ? "bg-red-600 text-white" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50")}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* The four answers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Answer
          n={1}
          q="How far from 100%?"
          value={`${Math.round(totPct * 100)}%`}
          tone={pctTone(totPct)}
          meter={totPct}
          line={<>{coverage.tot.days} of {coverage.tot.due} weekdays had a post · <b>{coverage.tot.due - coverage.tot.days} missed</b></>}
          delta={prevPct !== null ? <Delta cur={totPct} prev={prevPct} /> : null}
          deltaLabel={range.prevLabel}
        />
        <Answer
          n={2}
          q={`Stock for ${monthLabel(nextMk, true)}`}
          value={`${Math.round(stock.nextPct * 100)}%`}
          tone={pctTone(stock.nextPct)}
          meter={stock.nextPct}
          line={<>{stock.nextReadyTot} of {stock.nextDue * companies.length} weekdays have approved content</>}
          sub={`${stock.nextReviewTot} with client · ${stock.nextDraftsTot} drafts${stock.undatedTot ? ` · ${stock.undatedTot} approved, no date` : ""}`}
        />
        <Answer
          n={3}
          q="How successful are the posts?"
          value={epp.toFixed(1)}
          unit="engagements / post"
          line={<>{fmt(perf.tot.posts)} posts · {fmt(perf.tot.eng)} engagements{perf.tot.views ? ` · ${fmt(perf.tot.views)} views` : ""}</>}
          delta={hasPrev ? <Delta cur={epp} prev={eppPrev} /> : null}
          deltaLabel={range.prevLabel}
        />
        <Answer
          n={4}
          q="Getting more efficient?"
          value={eff.eppChange === null ? "—" : `${eff.eppChange >= 0 ? "+" : ""}${Math.round(eff.eppChange * 100)}%`}
          tone={eff.eppChange === null ? undefined : eff.eppChange >= 0 ? "#2E7D4F" : "#D92D20"}
          unit="engagement / post since start"
          line={eff.measured
            ? <>Last 3 months vs first 3 months of each campaign ({eff.measured} of {companies.length} companies)</>
            : <>Needs 4 full campaign months per company</>}
          sub={eff.covChange !== null ? `Days posted: ${eff.covChange >= 0 ? "+" : ""}${Math.round(eff.covChange * 100)} pts since start` : undefined}
        />
      </div>

      {/* 1 — Objective tracker */}
      <section className="gx-card overflow-hidden">
        <SectionHead n={1} title="Posting objective — one post every weekday" sub={`${windowLabel} · furthest from 100% first · a day counts when the company posted on LinkedIn or X`} />
        <div className="grid lg:grid-cols-5">
          <div className="lg:col-span-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 bg-gray-50">
                  <th className="px-5 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Weekdays posted</th>
                  <th className="px-3 py-2.5 font-medium">LinkedIn</th>
                  <th className="px-3 py-2.5 font-medium">X</th>
                  <th className="px-3 py-2.5 font-medium">Last 13 weeks</th>
                </tr>
              </thead>
              <tbody>
                {order.map(({ co, i }) => {
                  const c = coverage.cur[i];
                  const p = coverage.prev?.[i];
                  return (
                    <tr key={co.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <Link href={`/clients/${co.id}`} className="flex items-center gap-2.5 group">
                          <Logo co={co} /><span className="font-medium text-gray-900 group-hover:underline">{co.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Meter num={c.days} den={c.due} />
                        <div className="text-[11px] text-gray-500 mt-1">
                          {c.due - c.days} missed{p && p.due ? <> · <Delta cur={c.due ? c.days / c.due : 0} prev={p.days / p.due} small /></> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 gx-num text-xs"><Frac a={c.li} b={c.due} /></td>
                      <td className="px-3 py-3 gx-num text-xs"><Frac a={c.x} b={c.due} /></td>
                      <td className="px-3 py-3"><WeekDots values={coverage.perWeek[i]} due={coverage.weekDue} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="lg:col-span-2 border-t lg:border-t-0 lg:border-l border-gray-100 p-5">
            <div className="text-sm font-semibold text-gray-900">All campaigns, week by week</div>
            <div className="text-xs text-gray-500">Share of weekdays with a post · dashed line = 100%</div>
            <PctChart labels={coverage.weeks.map((wk, i) => (i === coverage.weeks.length - 1 ? "This wk" : shortDate(wk)))} values={coverage.weekPct} every={3} />
          </div>
        </div>
      </section>

      {/* 2 — Stock */}
      <section className="gx-card overflow-hidden">
        <SectionHead n={2} title="Content in stock" sub={`Approved or scheduled posts on a weekday · ${stock.restDue} weekdays left in ${monthLabel(mk, true)}, ${stock.nextDue} in ${monthLabel(nextMk, true)}`}
          action={<Link href="/publishing" className="text-xs font-medium text-red-700 hover:underline">Open Publishing</Link>} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 bg-gray-50">
                <th className="px-5 py-2.5 font-medium">Company</th>
                <th className="px-3 py-2.5 font-medium">Rest of {monthLabel(mk, true)}</th>
                <th className="px-3 py-2.5 font-medium">{monthLabel(nextMk, true)} ready</th>
                <th className="px-3 py-2.5 font-medium">{monthLabel(nextMk, true)} in progress</th>
                <th className="px-3 py-2.5 font-medium">Approved, no date</th>
                <th className="px-5 py-2.5 font-medium">Still to produce for {monthLabel(nextMk, true)}</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((co, i) => ({ co, i, s: stock.rows[i] }))
                .sort((a, b) => a.s.next - b.s.next)
                .map(({ co, s }) => {
                  const toMake = Math.max(0, stock.nextDue - s.next - s.nextReview - s.nextDrafts - s.undated);
                  return (
                    <tr key={co.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-5 py-3"><div className="flex items-center gap-2.5"><Logo co={co} /><span className="font-medium text-gray-900">{co.name}</span></div></td>
                      <td className="px-3 py-3"><Meter num={s.rest} den={stock.restDue} /></td>
                      <td className="px-3 py-3"><Meter num={s.next} den={stock.nextDue} /></td>
                      <td className="px-3 py-3 text-xs text-gray-700">{s.nextReview} with client · {s.nextDrafts} drafts</td>
                      <td className="px-3 py-3 gx-num text-gray-700">{s.undated || "—"}</td>
                      <td className="px-5 py-3">
                        {toMake === 0
                          ? <span className="gx-pill bg-green-50 text-green-800"><CheckCircle2 size={11} /> Covered</span>
                          : <span className="gx-pill bg-red-50 text-red-700">{toMake} posts</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3 — Performance */}
      <div className="grid gap-4 lg:grid-cols-5">
        <section className="gx-card overflow-hidden lg:col-span-3">
          <SectionHead n={3} title="How successful the posts are" sub={`${windowLabel} · engagement = likes + comments + reposts · followers are per company, change over 30 days`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 bg-gray-50">
                  <th className="px-5 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium text-right">Posts</th>
                  <th className="px-3 py-2.5 font-medium text-right">Engagement</th>
                  <th className="px-3 py-2.5 font-medium text-right">Per post</th>
                  <th className="px-3 py-2.5 font-medium">Followers</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((co, i) => ({ co, i, p: perf.cur[i], q: perf.prev[i] }))
                  .sort((a, b) => (b.p.posts ? b.p.eng / b.p.posts : 0) - (a.p.posts ? a.p.eng / a.p.posts : 0))
                  .map(({ co, p, q }) => (
                    <tr key={co.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-5 py-3"><div className="flex items-center gap-2.5"><Logo co={co} /><span className="font-medium text-gray-900">{co.name}</span></div></td>
                      <td className="px-3 py-3 text-right gx-num">{p.posts}</td>
                      <td className="px-3 py-3 text-right gx-num">{fmt(p.eng)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="gx-num font-semibold text-gray-900">{p.posts ? (p.eng / p.posts).toFixed(1) : "—"}</div>
                        {hasPrev && p.posts > 0 && q.posts > 0 && <Delta cur={p.eng / p.posts} prev={q.eng / q.posts} small />}
                      </td>
                      <td className="px-3 py-3">
                        {co.followers.length === 0 ? <span className="text-gray-400">—</span> : (
                          <div className="space-y-0.5">
                            {[...co.followers].sort((a, b) => a.platform.localeCompare(b.platform)).map((f) => {
                              const d = f.then !== null ? f.now - f.then : null;
                              return (
                                <div key={f.platform} className="flex items-center gap-1.5 text-xs">
                                  <Dot c={f.platform === "LINKEDIN" ? C_LI : C_X} />
                                  <span className="gx-num text-gray-900">{fmt(f.now)}</span>
                                  {d !== null && d !== 0 && <span className={"gx-num " + (d > 0 ? "text-green-700" : "text-red-700")}>{d > 0 ? "+" : ""}{fmt(d)}</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="gx-card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold text-gray-900">Top posts</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-2">Most engagement · {windowLabel.toLowerCase()}</p>
          {top.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">No posts in this period.</div>
          ) : (
            <ol className="divide-y divide-gray-100">
              {top.map((t, k) => (
                <li key={k} className="py-2.5 flex gap-3">
                  <div className="w-5 shrink-0 gx-num font-semibold text-gray-300">{k + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Dot c={t.platform === "LINKEDIN" ? C_LI : C_X} />
                      <span className="font-medium text-gray-900 truncate">{companies[t.c]?.name}</span>
                      <span className="shrink-0">· {shortDate(t.date)}</span>
                      {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-red-700 hover:underline inline-flex items-center gap-1">Open <ExternalLink size={11} /></a>}
                    </div>
                    <p className="text-[13px] text-gray-700 mt-0.5 line-clamp-2">{t.text || "(no text)"}</p>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500 gx-num">
                      <span className="flex items-center gap-1"><Heart size={11} />{fmt(t.likes)}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={11} />{fmt(t.comments)}</span>
                      <span className="flex items-center gap-1"><Repeat2 size={11} />{fmt(t.shares)}</span>
                      {t.views > 0 && <span className="flex items-center gap-1"><Eye size={11} />{fmt(t.views)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* 4 — Efficiency over the campaign */}
      <section className="gx-card overflow-hidden">
        <SectionHead n={4} title="Efficiency over the campaign" sub="Month by month since each campaign started · start = first 3 full months, now = last 3 full months" />
        <div className="grid lg:grid-cols-5">
          <div className="lg:col-span-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs text-gray-500 bg-gray-50">
                  <th className="px-5 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Weekdays posted / month</th>
                  <th className="px-3 py-2.5 font-medium">Engagement / post</th>
                  <th className="px-3 py-2.5 font-medium">Start → now</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((co, i) => {
                  const e = eff.perCo[i];
                  return (
                    <tr key={co.id} className="border-t border-gray-100 hover:bg-gray-50 align-middle">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5"><Logo co={co} />
                          <div>
                            <div className="font-medium text-gray-900">{co.name}</div>
                            <div className="text-[11px] text-gray-500">{e ? `Month ${e.age} · since ${monthLabel(monthKey(co.campaignStart!))}` : "No start date"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">{e ? <PctBars values={e.months.map((m) => m.cov)} labels={e.months.map((m) => monthLabel(m.mk))} /> : "—"}</td>
                      <td className="px-3 py-3">{e && e.months.some((m) => m.epp !== null) ? <Spark values={e.months.map((m) => m.epp ?? 0)} /> : "—"}</td>
                      <td className="px-3 py-3 text-xs">
                        {e && e.eppStart !== null && e.eppNow !== null ? (
                          <div className="space-y-0.5 gx-num">
                            <div>Days <span className="text-gray-500">{Math.round(e.covStart! * 100)}%</span> → <b style={{ color: pctTone(e.covNow!) }}>{Math.round(e.covNow! * 100)}%</b></div>
                            <div>Eng/post <span className="text-gray-500">{e.eppStart.toFixed(1)}</span> → <b className="text-gray-900">{e.eppNow.toFixed(1)}</b> <Delta cur={e.eppNow} prev={e.eppStart} small /></div>
                          </div>
                        ) : <span className="text-gray-400">Too early ({e ? e.age : 0} months)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="lg:col-span-2 border-t lg:border-t-0 lg:border-l border-gray-100 p-5 space-y-5">
            <div>
              <div className="text-sm font-semibold text-gray-900">Weekdays posted, all campaigns</div>
              <div className="text-xs text-gray-500">Last 12 months · dashed line = 100%</div>
              <PctChart labels={eff.cal.map((c) => monthLabel(c.mk))} values={eff.cal.map((c) => c.cov)} every={2} h={150} />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Engagement per post, all campaigns</div>
              <LineChart labels={eff.cal.map((c) => monthLabel(c.mk))} values={eff.cal.map((c) => c.epp)} />
            </div>
          </div>
        </div>
      </section>

      {/* Operations */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="gx-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Publishing pipeline</h2>
            <Link href="/publishing" className="text-xs font-medium text-red-700 hover:underline">Open</Link>
          </div>
          <Pipeline p={data.pipeline} />
        </section>
        <section className="gx-card p-5">
          <div className="text-base font-semibold text-gray-900 flex items-center gap-1.5"><CalendarClock size={15} /> Next up</div>
          {data.upcoming.length === 0 ? <div className="text-sm text-gray-500 mt-3">Nothing scheduled.</div> : (
            <ul className="space-y-2.5 mt-3">
              {data.upcoming.slice(0, 5).map((u, k) => (
                <li key={k} className="flex gap-2.5 text-sm">
                  <div className="w-12 shrink-0 text-xs text-gray-500 gx-num pt-0.5">{new Date(u.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-900 flex items-center gap-1.5"><Dot c={u.platform === "LINKEDIN" ? C_LI : C_X} /> {companies[u.c]?.name}</div>
                    <div className="text-xs text-gray-500 truncate">{u.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="gx-card p-5">
          <h2 className="text-base font-semibold text-gray-900">Data collection</h2>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">Last run {relTime(data.lastUpdate)}</p>
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
        </section>
      </div>
    </div>
  );
}

/* ───────── new pieces ───────── */

function SectionHead({ n, title, sub, action }: { n: number; title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
      <div className="flex gap-3">
        <span className="w-6 h-6 rounded-full bg-red-600 text-white text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function Answer({
  n, q, value, unit, tone, meter, line, sub, delta, deltaLabel,
}: {
  n: number; q: string; value: string; unit?: string; tone?: string; meter?: number;
  line: React.ReactNode; sub?: string; delta?: React.ReactNode; deltaLabel?: string;
}) {
  return (
    <div className="gx-card p-5 flex flex-col">
      <div className="flex items-center gap-2 text-[13px] font-medium text-gray-600">
        <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[11px] font-semibold flex items-center justify-center">{n}</span>{q}
      </div>
      <div className="flex items-baseline gap-2 mt-3">
        <div className="text-[34px] leading-none font-semibold gx-num whitespace-nowrap" style={{ color: tone ?? "#15171C" }}>{value}</div>
        {unit && <div className="text-xs text-gray-500">{unit}</div>}
      </div>
      {meter !== undefined && (
        <div className="h-2 bg-gray-100 rounded-full mt-3 overflow-hidden relative">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, meter * 100)}%`, background: tone }} />
        </div>
      )}
      <div className="text-xs text-gray-600 mt-3">{line}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
      {delta && <div className="mt-auto pt-3 text-xs text-gray-500 flex items-center gap-1.5">{delta} vs {deltaLabel}</div>}
    </div>
  );
}

function Meter({ num, den }: { num: number; den: number }) {
  if (!den) return <span className="text-xs text-gray-400">—</span>;
  const p = num / den;
  const c = pctTone(p);
  return (
    <div className="w-44">
      <div className="flex justify-between text-xs">
        <span className="gx-num font-semibold text-gray-900">{num}<span className="text-gray-400 font-normal"> / {den}</span></span>
        <span className="gx-num font-medium" style={{ color: c }}>{Math.round(p * 100)}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, p * 100)}%`, background: c }} />
      </div>
    </div>
  );
}

function Frac({ a, b }: { a: number; b: number }) {
  if (!b) return <span className="text-gray-400">—</span>;
  return <span style={{ color: pctTone(a / b) }}>{a}<span className="text-gray-400">/{b}</span></span>;
}

/** 13 weeks × 5 weekdays: each week a column of 5 squares, filled = posted that day. */
function WeekDots({ values, due }: { values: number[]; due: number[] }) {
  return (
    <svg width={13 * 8} height={5 * 6} aria-hidden className="block">
      {values.map((v, i) =>
        [0, 1, 2, 3, 4].map((d) => {
          const filled = d < v;
          const notYet = d >= due[i];
          return (
            <rect key={`${i}-${d}`} x={i * 8} y={(4 - d) * 6} width={6} height={4} rx={1}
              fill={notYet ? "#F3F1EC" : filled ? (v === 5 ? "#2E7D4F" : "#86C79A") : "#F6BBB3"} />
          );
        }),
      )}
      <title>{values.map((v, i) => `${v}/${due[i]}`).join("  ")}</title>
    </svg>
  );
}

function PctBars({ values, labels }: { values: number[]; labels: string[] }) {
  const W = 12 * 9, H = 28;
  return (
    <svg width={W} height={H} aria-hidden className="block">
      {values.map((v, i) => {
        const h = Math.max(1, v * H);
        return (
          <rect key={i} x={i * 9} y={H - h} width={7} height={h} rx={1} fill={pctTone(v)}>
            <title>{`${labels[i]}: ${Math.round(v * 100)}%`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function PctChart({ labels, values, every = 2, h = 190 }: { labels: string[]; values: number[]; every?: number; h?: number }) {
  const W = 460, H = h, L = 34, B = 22, T = 8;
  const y = (v: number) => T + (H - T - B) * (1 - v);
  const slot = (W - L) / Math.max(1, values.length);
  const bw = Math.min(26, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3" role="img">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke={t === 1 ? C_TARGET : "#E6E3DC"} strokeDasharray={t === 1 ? "5 4" : undefined} strokeWidth={t === 1 ? 1.5 : 1} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#9A9DA5">{t * 100}%</text>
        </g>
      ))}
      {values.map((v, i) => {
        const cx = L + slot * i + slot / 2;
        return (
          <g key={i}>
            <title>{`${labels[i]}: ${Math.round(v * 100)}%`}</title>
            <rect x={cx - bw / 2} y={y(Math.min(1, v))} width={bw} height={Math.max(0, y(0) - y(Math.min(1, v)))} rx={2} fill={pctTone(v)} />
            <text x={cx} y={y(Math.min(1, v)) - 3} textAnchor="middle" fontSize="9" fill="#50545D">{Math.round(v * 100)}</text>
            {(i % every === 0 || i === values.length - 1) && <text x={cx} y={H - 5} textAnchor="middle" fontSize="10" fill="#9A9DA5">{labels[i]}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ labels, values }: { labels: string[]; values: (number | null)[] }) {
  const W = 460, H = 140, L = 34, B = 22, T = 14;
  const nums = values.filter((v): v is number => v !== null);
  if (!nums.length) return <div className="text-xs text-gray-500 mt-3">No posts yet.</div>;
  const max = Math.max(...nums) * 1.15 || 1;
  const slot = (W - L) / Math.max(1, values.length);
  const x = (i: number) => L + slot * i + slot / 2;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const pts = values.map((v, i) => (v === null ? null : [x(i), y(v)] as const));
  const d = pts.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p![0].toFixed(1)},${p![1].toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3" role="img">
      {[0, max / 2, max].map((t, k) => (
        <g key={k}>
          <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="#E6E3DC" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#9A9DA5">{t.toFixed(0)}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke={C_TARGET} strokeWidth={2} strokeLinejoin="round" />
      {pts.map((p, i) => p && (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r={3} fill="#fff" stroke={C_TARGET} strokeWidth={1.5}><title>{`${labels[i]}: ${values[i]!.toFixed(1)}`}</title></circle>
          {(i % 2 === 0 || i === values.length - 1) && <text x={p[0]} y={H - 5} textAnchor="middle" fontSize="10" fill="#9A9DA5">{labels[i]}</text>}
        </g>
      ))}
    </svg>
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

