"use client";

/**
 * Companies — v4.14.0, manager view.
 *
 * One row per company, one verdict per row, one plain sentence saying why.
 * The rule is the Dashboard's (src/lib/verdict.ts). Links, slugs, campaign
 * dates and sync timestamps moved off this table — they live on each
 * company's own page, one click away.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, AlertTriangle, RefreshCw, Loader2, Search } from "lucide-react";
import { Header } from "@/components/layout/header";
import {
  COLLECTED_NETWORKS,
  VERDICT_META,
  daysSinceDate,
  judge,
  lastPostLabel,
  type Verdict,
} from "@/lib/verdict";

interface PlatformConn {
  platform: string;
  connectionStatus: string;
}

interface Client {
  id: string;
  name: string;
  status: string;
  clientType: string | null;
  platformConnections: PlatformConn[];
}

type Activity = Record<string, { lastPostDateLocal: string | null; postsThisMonth: number; posts30: number }>;

const CATEGORIES = [
  { key: "ALL", label: "All" },
  { key: "CAMPAIGN", label: "Campaign" },
  { key: "CLIENT", label: "Client" },
  { key: "PROSPECT", label: "Prospect" },
  { key: "PARTNER", label: "Partner" },
  { key: "COMPETITION", label: "Competition" },
  { key: "INTERNAL", label: "Internal" },
  { key: "RECYCLED", label: "Recycled" },
];

const VIEWS = [
  { key: "action", label: "Needs action" },
  { key: "ok", label: "On track" },
  { key: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["key"];

function cap(s: string): string {
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : "—";
}

async function getJson<T>(url: string): Promise<T> {
  let lastErr = "";
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      const j = await r.json().catch(() => null);
      if (r.ok && j?.success) return j.data as T;
      lastErr = j?.error || `HTTP ${r.status}`;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e instanceof Error ? (e.name === "AbortError" ? "Request timed out" : e.message) : "Network error";
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
  throw new Error(lastErr || "Could not load");
}

type Row = Client & {
  verdict: Verdict;
  reason: string;
  daysSince: number;
  posts30: number;
  nets: { key: string; ok: boolean }[];
};

export function ClientsPageClient() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [activity, setActivity] = useState<Activity>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [category, setCategory] = useState("ALL");
  const [view, setView] = useState<View>("action");
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [c, a] = await Promise.all([
          getJson<Client[]>("/api/clients?light=1"),
          getJson<Activity>("/api/clients/activity").catch(() => ({}) as Activity),
        ]);
        if (!cancelled) {
          setClients(c);
          setActivity(a);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load companies");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const rows: Row[] = useMemo(() => {
    if (!clients) return [];
    return clients.map((c) => {
      const conns = c.platformConnections.filter((p) => p.platform in COLLECTED_NETWORKS);
      const broken = conns
        .filter((p) => p.connectionStatus === "ERROR" || p.connectionStatus === "EXPIRED")
        .map((p) => p.platform);
      const act = activity[c.id];
      const daysSince = daysSinceDate(act?.lastPostDateLocal);
      const j = judge({
        active: c.status === "ACTIVE",
        daysSince,
        networks: conns.map((p) => p.platform),
        brokenNetworks: broken,
        postsThisMonth: act?.postsThisMonth ?? 0,
      });
      return {
        ...c,
        ...j,
        daysSince,
        posts30: act?.posts30 ?? 0,
        nets: conns.map((p) => ({ key: p.platform, ok: !broken.includes(p.platform) })),
      };
    });
  }, [clients, activity]);

  const inCategory = useMemo(
    () => rows.filter((r) => category === "ALL" || (r.clientType ?? "").toUpperCase() === category),
    [rows, category],
  );
  const needs = inCategory.filter((r) => VERDICT_META[r.verdict].needsAction);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return inCategory
      .filter((r) =>
        view === "all" ? true : view === "action" ? VERDICT_META[r.verdict].needsAction : r.verdict === "ok",
      )
      .filter((r) => !term || r.name.toLowerCase().includes(term))
      .sort(
        (a, b) =>
          VERDICT_META[a.verdict].rank - VERDICT_META[b.verdict].rank ||
          b.daysSince - a.daysSince ||
          a.name.localeCompare(b.name),
      );
  }, [inCategory, view, q]);

  const subtitle = loading
    ? "Loading…"
    : `${inCategory.length} companies · ${needs.length === 0 ? "none need action" : `${needs.length} need action`}`;

  return (
    <div>
      <Header
        title="Companies"
        subtitle={subtitle}
        actions={
          <Link
            href="/admin?tab=clients&action=new"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
          >
            <Plus size={15} />
            Add company
          </Link>
        }
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          Loading companies…
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md mt-8 p-6 text-center bg-white border border-gray-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto text-red-700 mb-2" />
          <div className="text-sm font-semibold text-gray-900">Could not load companies</div>
          <div className="text-xs text-gray-600 mt-1">{error}</div>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={12} />
            Try again
          </button>
        </div>
      )}

      {!loading && !error && clients && (
        <div className="space-y-4">
          {/* Category */}
          <div className="flex flex-wrap gap-1 border-b border-gray-200">
            {CATEGORIES.map((t) => {
              const count =
                t.key === "ALL" ? rows.length : rows.filter((r) => (r.clientType ?? "").toUpperCase() === t.key).length;
              if (t.key !== "ALL" && count === 0) return null;
              const on = category === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setCategory(t.key)}
                  className={
                    "px-3 py-2.5 -mb-px text-sm border-b-2 transition-colors " +
                    (on ? "border-red-600 text-gray-900 font-semibold" : "border-transparent text-gray-600 hover:text-gray-900")
                  }
                >
                  {t.label} <span className="ml-1 text-xs text-gray-500 font-mono">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Needs action / On track / All + search */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex bg-white border border-gray-200 rounded-lg p-0.5">
              {VIEWS.map((v) => {
                const n =
                  v.key === "all"
                    ? inCategory.length
                    : v.key === "action"
                      ? needs.length
                      : inCategory.filter((r) => r.verdict === "ok").length;
                const on = view === v.key;
                return (
                  <button
                    key={v.key}
                    onClick={() => setView(v.key)}
                    className={
                      "px-3 h-8 rounded-md text-sm transition-colors " +
                      (on ? "bg-gray-900 text-white font-medium" : "text-gray-600 hover:text-gray-900")
                    }
                  >
                    {v.label} <span className={"ml-1 text-xs font-mono " + (on ? "text-gray-300" : "text-gray-500")}>{n}</span>
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 h-9 px-3 w-64 bg-white border border-gray-200 rounded-lg text-gray-500">
              <Search size={15} />
              <span className="sr-only">Search companies</span>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search companies"
                className="flex-1 bg-transparent outline-none text-sm text-gray-900"
              />
            </label>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 bg-gray-50">
                  <th className="px-5 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Why</th>
                  <th className="px-3 py-2.5 font-medium">Last post</th>
                  <th className="px-3 py-2.5 font-medium text-right">Posts · 30 days</th>
                  <th className="px-5 py-2.5 font-medium">Networks</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <Link href={`/clients/${r.id}`} className="font-medium text-gray-900 hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-gray-500">{cap(r.clientType ?? "")}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={"inline-flex text-xs font-medium px-2.5 py-0.5 rounded-full " + VERDICT_META[r.verdict].pill}>
                        {VERDICT_META[r.verdict].label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-gray-700">{r.reason}</td>
                    <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{lastPostLabel(r.daysSince)}</td>
                    <td className="px-3 py-3 text-right font-mono">{r.posts30}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        {r.nets.length === 0 && <span className="text-xs text-gray-500">None</span>}
                        {r.nets.map((n) => (
                          <span
                            key={n.key}
                            title={n.ok ? `${COLLECTED_NETWORKS[n.key]}: collected` : `${COLLECTED_NETWORKS[n.key]}: not collected`}
                            className={
                              "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border " +
                              (n.ok ? "border-gray-200 text-gray-700" : "border-red-200 bg-red-50 text-red-700")
                            }
                          >
                            <span className={"w-1.5 h-1.5 rounded-full " + (n.ok ? "bg-green-600" : "bg-red-600")} />
                            {COLLECTED_NETWORKS[n.key]}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-600">
                      {view === "action" && !q ? "No company needs action here." : "No companies match."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
