"use client";

/**
 * View filters — one shared filter state for the whole dashboard, driven from
 * the left menu instead of a row of tabs on every page.
 *
 * Why here and not per page: the campaign book of work is what matters day to
 * day, and every page was growing its own tab strip. Hoisting category /
 * month / network into the sidebar means one place to narrow the view, and
 * the pages stay about the numbers.
 *
 * Semantics: an EMPTY selection means "no filter" (show everything), not
 * "show nothing" — that is the least surprising reading of a checkbox group
 * where the user has unticked the last box. `month` is single-valued:
 * "ALL" or a "YYYY-MM" key.
 *
 * State is kept in sessionStorage so it survives navigation within a session
 * but never becomes a permanent surprise on the next login. It is read in an
 * effect (not during render) so the server and client first paint agree.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const CATEGORY_OPTIONS = [
  { key: "CAMPAIGN", label: "Campaign" },
  { key: "CLIENT", label: "Client" },
  { key: "PROSPECT", label: "Prospect" },
  { key: "PARTNER", label: "Partner" },
  { key: "COMPETITION", label: "Competition" },
  { key: "INTERNAL", label: "Internal" },
  { key: "RECYCLED", label: "Recycled" },
] as const;

export const NETWORK_OPTIONS = [
  { key: "LINKEDIN", label: "LinkedIn" },
  { key: "TWITTER", label: "X / Twitter" },
  { key: "GOOGLE_BUSINESS", label: "Google Business" },
  { key: "TIKTOK", label: "TikTok" },
] as const;

/** The default view: campaign companies, current month, every network. */
export const DEFAULT_CATEGORIES = ["CAMPAIGN"];

export interface ViewFilters {
  categories: string[];
  networks: string[];
  month: string; // "ALL" | "YYYY-MM"
}

interface Ctx extends ViewFilters {
  ready: boolean;
  toggleCategory: (key: string) => void;
  toggleNetwork: (key: string) => void;
  setMonth: (m: string) => void;
  setCategories: (keys: string[]) => void;
  reset: () => void;
  /** True when anything is narrowed away from the default view. */
  isDefault: boolean;
}

const STORAGE_KEY = "social.viewFilters.v1";

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last `n` months, newest first, as { key, label }. */
export function recentMonths(n = 12, now = new Date()): Array<{ key: string; label: string }> {
  const out: Array<{ key: string; label: string }> = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({
      key,
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
}

/** First and last day of a month key, capped at today. "ALL" spans everything. */
export function monthRange(month: string, now = new Date()): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  if (month === "ALL") return { from: "2000-01-01", to: today };
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: first, to: last > today ? today : last };
}

const FilterCtx = createContext<Ctx | null>(null);

export function ViewFiltersProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategoriesState] = useState<string[]>(DEFAULT_CATEGORIES);
  const [networks, setNetworksState] = useState<string[]>([]);
  const [month, setMonthState] = useState<string>(currentMonthKey());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p.categories)) setCategoriesState(p.categories);
        if (Array.isArray(p.networks)) setNetworksState(p.networks);
        if (typeof p.month === "string") setMonthState(p.month);
      }
    } catch { /* private mode — defaults are fine */ }
    setReady(true);
  }, []);

  const persist = useCallback((next: ViewFilters) => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }, []);

  const toggleCategory = useCallback((key: string) => {
    setCategoriesState((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      persist({ categories: next, networks, month });
      return next;
    });
  }, [networks, month, persist]);

  const toggleNetwork = useCallback((key: string) => {
    setNetworksState((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      persist({ categories, networks: next, month });
      return next;
    });
  }, [categories, month, persist]);

  const setMonth = useCallback((m: string) => {
    setMonthState(m);
    persist({ categories, networks, month: m });
  }, [categories, networks, persist]);

  const setCategories = useCallback((keys: string[]) => {
    setCategoriesState(keys);
    persist({ categories: keys, networks, month });
  }, [networks, month, persist]);

  const reset = useCallback(() => {
    const next = { categories: DEFAULT_CATEGORIES, networks: [], month: currentMonthKey() };
    setCategoriesState(next.categories);
    setNetworksState(next.networks);
    setMonthState(next.month);
    persist(next);
  }, [persist]);

  const isDefault =
    categories.length === DEFAULT_CATEGORIES.length &&
    categories.every((c) => DEFAULT_CATEGORIES.includes(c)) &&
    networks.length === 0 &&
    month === currentMonthKey();

  const value = useMemo<Ctx>(
    () => ({ categories, networks, month, ready, toggleCategory, toggleNetwork, setMonth, setCategories, reset, isDefault }),
    [categories, networks, month, ready, toggleCategory, toggleNetwork, setMonth, setCategories, reset, isDefault],
  );

  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export function useViewFilters(): Ctx {
  const ctx = useContext(FilterCtx);
  if (!ctx) {
    throw new Error("useViewFilters must be used inside <ViewFiltersProvider>");
  }
  return ctx;
}

/** Does a company pass the category filter? Empty selection = everything. */
export function matchesCategory(clientType: string | null | undefined, categories: string[]): boolean {
  if (categories.length === 0) return true;
  return categories.includes((clientType ?? "").toUpperCase());
}

/** Does a company pass the network filter? Empty selection = everything. */
export function matchesNetwork(platforms: string[], networks: string[]): boolean {
  if (networks.length === 0) return true;
  return platforms.some((p) => networks.includes(p));
}
