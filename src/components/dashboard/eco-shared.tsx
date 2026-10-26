"use client";

/**
 * Shared pieces for Social's own Dashboard and Summary (v4.65.0):
 * window picker, category palette, filter application and formatting.
 * No charting library — bars are plain CSS (edge bundle budget).
 */
import { useEffect, useMemo, useState } from "react";
import type { EcoData, CollectionState } from "@/lib/ecosystem/data";
import { WINDOW_KEYS, WINDOW_LABELS, DEFAULT_WINDOW, type WindowKey } from "@/lib/ecosystem/windows";
import { matchesCategory, useViewFilters } from "@/lib/view-filters";

export const NET_KEYS = ["LINKEDIN", "TWITTER"] as const;
export const NET_LABEL = ["LinkedIn", "X"];

/** Fixed slot order so a category keeps its colour whatever the filter shows. */
export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  COMPANY: { label: "Company", color: "#B91C1C" },
  CLIENT: { label: "Client", color: "#1D4ED8" },
  PARTNER: { label: "Partner", color: "#0F766E" },
  COMPETITION: { label: "Competitor", color: "#7C3AED" },
  PROSPECT: { label: "Prospect", color: "#B45309" },
  INTERNAL: { label: "Internal", color: "#374151" },
  CAMPAIGN: { label: "Campaign", color: "#BE185D" },
  RECYCLED: { label: "Recycled", color: "#6B7280" },
};
export const CATEGORY_ORDER = Object.keys(CATEGORY_META);
export const catLabel = (t: string) => CATEGORY_META[t]?.label ?? t;
export const catColor = (t: string) => CATEGORY_META[t]?.color ?? "#6B7280";

export const STATE_META: Record<CollectionState, { label: string; color: string; icon: string }> = {
  collected: { label: "Collected", color: "#15803D", icon: "●" },
  empty: { label: "Checked, nothing new", color: "#4D7C0F", icon: "○" },
  stale: { label: "Stale (>48h)", color: "#B45309", icon: "◐" },
  failed: { label: "Failing", color: "#B91C1C", icon: "✕" },
  never: { label: "Never checked", color: "#6B7280", icon: "–" },
};

const WIN_KEY = "social.ecoWindow.v1";

/** The page's period picker, remembered for the session. */
export function useEcoWindow(): [WindowKey, (k: WindowKey) => void] {
  const [win, setWin] = useState<WindowKey>(DEFAULT_WINDOW);
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(WIN_KEY) as WindowKey | null;
      if (v && (WINDOW_KEYS as readonly string[]).includes(v)) setWin(v);
    } catch { /* private mode */ }
  }, []);
  return [
    win,
    (k: WindowKey) => {
      setWin(k);
      try { sessionStorage.setItem(WIN_KEY, k); } catch { /* private mode */ }
    },
  ];
}

export function WindowPicker({ value, onChange }: { value: WindowKey; onChange: (k: WindowKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-[12px]" role="tablist" aria-label="Period">
      {WINDOW_KEYS.map((k) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={
            "px-2.5 py-1 rounded-md font-medium transition-colors " +
            (value === k ? "bg-[#111317] text-white" : "text-gray-600 hover:bg-gray-100")
          }
        >
          {WINDOW_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

export interface CompanyStat {
  i: number;
  posts: number;
  prev: number | null;
  eng: number;
  prevEng: number | null;
  byNet: [number, number];
  prevByNet: [number, number];
}

/**
 * Apply the sidebar category + network filters and sum the aggregates for one
 * window. Returns one stat per visible company (zero rows included).
 */
export function useFiltered(data: EcoData, win: WindowKey) {
  const { categories, networks } = useViewFilters();
  return useMemo(() => {
    const wIdx = data.windows.findIndex((w) => w.key === win);
    const w = data.windows[wIdx];
    const hasPrev = !!w?.prevFrom;
    const netOn = (n: number) => networks.length === 0 || networks.includes(NET_KEYS[n]);
    const visible = data.companies
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => matchesCategory(c.type, categories))
      .filter(({ c }) => networks.length === 0 || c.networks.length === 0 || c.networks.some((n) => networks.includes(n)));
    const visSet = new Set(visible.map((v) => v.i));
    const stats = new Map<number, CompanyStat>();
    for (const { i } of visible) {
      stats.set(i, { i, posts: 0, prev: hasPrev ? 0 : null, eng: 0, prevEng: hasPrev ? 0 : null, byNet: [0, 0], prevByNet: [0, 0] });
    }
    for (const [c, n, wi, p, pp, e, pe] of data.agg) {
      if (wi !== wIdx || !visSet.has(c) || !netOn(n)) continue;
      const s = stats.get(c)!;
      s.posts += p;
      s.eng += e;
      s.byNet[n] += p;
      s.prevByNet[n] += pp;
      if (hasPrev) {
        s.prev = (s.prev ?? 0) + pp;
        s.prevEng = (s.prevEng ?? 0) + pe;
      }
    }
    const conns = data.conns.filter(([c, n]) => visSet.has(c) && netOn(n));
    return { w, wIdx, hasPrev, visible, visSet, stats, conns, netOn, categories, networks };
  }, [data, win, categories, networks]);
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "K";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function fmtDay(d: string | null): string {
  if (!d) return "—";
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return "under 1h ago";
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Delta({ cur, prev, suffix = "" }: { cur: number; prev: number | null; suffix?: string }) {
  if (prev === null) return <span className="text-gray-400 text-[11px]">no comparison</span>;
  if (prev === 0) return <span className="text-gray-500 text-[11px]">{cur > 0 ? "new (none before)" : "same as before"}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct > 0;
  const cls = pct === 0 ? "text-gray-500" : up ? "text-green-700" : "text-red-700";
  return (
    <span className={cls + " text-[11px] font-medium"}>
      {pct === 0 ? "±0%" : `${up ? "▲" : "▼"} ${Math.abs(pct)}%`} <span className="text-gray-400 font-normal">vs {fmtNum(prev)}{suffix}</span>
    </span>
  );
}

export function CatChip({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-700 whitespace-nowrap">
      <span className="w-2 h-2 rounded-sm" style={{ background: catColor(type) }} aria-hidden />
      {catLabel(type)}
    </span>
  );
}

export function NetBadge({ n }: { n: number }) {
  return (
    <span
      className={
        "inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded " +
        (n === 0 ? "bg-[#E8F0FB] text-[#0A66C2]" : "bg-gray-100 text-gray-900")
      }
    >
      {n === 0 ? "in" : "X"}
    </span>
  );
}

/** Human description of what the sidebar filters currently show. */
export function scopeText(categories: string[], networks: string[]): string {
  const cats = categories.length === 0 ? "All categories" : categories.map(catLabel).join(", ");
  const nets = networks.length === 0 ? "all networks" : networks.map((n) => (n === "LINKEDIN" ? "LinkedIn" : n === "TWITTER" ? "X" : n)).join(", ");
  return `${cats} · ${nets}`;
}

export function windowRangeText(w: { from: string; to: string; prevFrom: string | null; prevTo: string | null } | undefined): string {
  if (!w) return "";
  if (!w.prevFrom) return `All collected posts up to ${fmtDay(w.to)}`;
  return `${fmtDay(w.from)} – ${fmtDay(w.to)} vs ${fmtDay(w.prevFrom)} – ${fmtDay(w.prevTo)}`;
}
