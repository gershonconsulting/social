"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDemoMode } from "@/lib/use-demo-mode";
import { Header } from "@/components/layout/header";
import { Loader2, AlertTriangle, RefreshCw, Check, X as XIcon, ExternalLink } from "lucide-react";

interface PerPlatform {
  hasLink: boolean;
  hasData: boolean;
  upToDate: boolean;
  postCount: number;
  latestPostAt: string | null;
  externalAccountUrl: string | null;
}

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  clientType: string;
  website: string | null;
  platforms: Record<string, PerPlatform>;
}

const COLUMNS: { platform: string; label: string }[] = [
  { platform: "LINKEDIN", label: "LinkedIn" },
  { platform: "TWITTER", label: "X / Twitter" },
  { platform: "GOOGLE_BUSINESS", label: "Google My Business" },
];

// Build with the 5-retry fetch pattern we use everywhere else.
async function fetchWithRetry(url: string): Promise<Response | null> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) return r;
      if (r.status < 500) return r;
    } catch { /* network */ }
    await new Promise((res) => setTimeout(res, 250 * (i + 1)));
  }
  return null;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function ChecksCell({ p }: { p: PerPlatform }) {
  // Tier:
  //   0 checks → no link configured  (gray dash)
  //   1 check  → link on file, no data ever  (1 green)
  //   2 checks → data exists but stale (>14 days)  (2 green)
  //   3 checks → up to date (post in last 14 days)  (3 green)
  let tier = 0;
  if (p.hasLink) tier = 1;
  if (p.hasLink && p.hasData) tier = 2;
  if (p.hasLink && p.hasData && p.upToDate) tier = 3;

  const tooltip = (() => {
    const parts: string[] = [];
    parts.push(`Link: ${p.hasLink ? p.externalAccountUrl ?? "yes" : "not configured"}`);
    parts.push(`Posts on file: ${p.postCount}`);
    if (p.latestPostAt) parts.push(`Latest post: ${relTime(p.latestPostAt)}`);
    else parts.push("Latest post: —");
    parts.push(`Up to date: ${p.upToDate ? "yes (≤14d)" : "no"}`);
    return parts.join("\n");
  })();

  return (
    <div className="px-3 py-3 text-center border-l border-gray-100" title={tooltip}>
      {tier === 0 ? (
        <XIcon size={20} strokeWidth={3} className="text-red-500 inline-block" />
      ) : (
        <div className="inline-flex items-center justify-center gap-0.5">
          {Array.from({ length: tier }).map((_, i) => (
            <Check key={i} size={18} strokeWidth={3} className="text-green-600" />
          ))}
        </div>
      )}
      {p.postCount > 0 && (
        <div className="text-[10px] text-gray-400 mt-1">{p.postCount} post{p.postCount === 1 ? "" : "s"}</div>
      )}
      {p.externalAccountUrl && (
        <a
          href={p.externalAccountUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-blue-600 mt-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={9} />
          link
        </a>
      )}
    </div>
  );
}

interface CollectionStats {
  activeClients: number;
  platforms: number;
  totalCells: number;
  cellsWithLink: number;
  cellsWithData: number;
  cellsFresh7d: number;
  cellsFresh14d: number;
  cellsFresh24h: number;
  clientsWithDataEver: number;
  clientsWithData7d: number;
  clientsWithData24h: number;
}

export function CoveragePageClient() {
  const demoMode = useDemoMode();
  const [rawClients, setClients] = useState<ClientRow[] | null>(null);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<"all" | "issues" | "perfect">("all");
  const [catFilter, setCatFilter] = useState<string>("ALL");
  // In demo mode, force every cell to tier-3 (✓✓✓): hasLink + hasData + upToDate.
  // Synthetic post counts so the hover tooltip still looks plausible.
  const clients: ClientRow[] | null = demoMode && rawClients
    ? rawClients.map((c) => ({
        ...c,
        platforms: Object.fromEntries(
          Object.entries(c.platforms).map(([k, v]) => [k, {
            ...v,
            hasLink: true,
            hasData: true,
            upToDate: true,
            postCount: v.postCount > 0 ? v.postCount : 80 + (c.id.charCodeAt(0) % 50),
            latestPostAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
            externalAccountUrl: v.externalAccountUrl || ("https://example.com/" + k.toLowerCase() + "/" + c.slug),
          }])
        ),
      }))
    : rawClients;

  useEffect(() => {
    let cancelled = false;
    setClients(null);
    setError("");
    (async () => {
      const r = await fetchWithRetry("/api/admin/coverage");
      if (cancelled) return;
      if (!r) { setError("All retries failed"); return; }
      if (!r.ok) { setError(`HTTP ${r.status}`); return; }
      try {
        const j = await r.json();
        if (j.success) {
          setClients(j.data.clients);
          if (j.data.stats) setStats(j.data.stats);
        } else setError(j.error || "Unknown error");
      } catch {
        setError("Server returned non-JSON response");
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const loading = clients === null && !error;

  // Category tabs — built from the data so only non-empty categories show.
  const categoryCounts = (() => {
    const m: Record<string, number> = {};
    for (const c of clients ?? []) {
      const k = (c.clientType ?? "").toUpperCase() || "UNKNOWN";
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  })();
  // Preferred display order, mirroring the Dashboard category tabs.
  const CATEGORY_ORDER = ["CAMPAIGN", "CLIENT", "PROSPECT", "PARTNER", "COMPETITION", "COMPANY", "INTERNAL"];
  const categoryTabs = [
    { key: "ALL", label: "All", count: clients?.length ?? 0 },
    ...CATEGORY_ORDER.filter((k) => categoryCounts[k] > 0).map((k) => ({
      key: k,
      label: k.charAt(0) + k.slice(1).toLowerCase(),
      count: categoryCounts[k],
    })),
    // Any leftover categories not in the preferred order.
    ...Object.keys(categoryCounts)
      .filter((k) => !CATEGORY_ORDER.includes(k))
      .map((k) => ({ key: k, label: k.charAt(0) + k.slice(1).toLowerCase(), count: categoryCounts[k] })),
  ];

  // Scope everything (summary tiles + table) to the selected category.
  const scoped: ClientRow[] = !clients
    ? []
    : catFilter === "ALL"
      ? clients
      : clients.filter((c) => (c.clientType ?? "").toUpperCase() === catFilter);

  // Summary: count each tier × platform (within the selected category)
  const summary = (() => {
    if (!clients) return null;
    const s = {
      totalCells: 0,
      none: 0, oneCheck: 0, twoChecks: 0, threeChecks: 0,
      perPlatform: {} as Record<string, { none: number; one: number; two: number; three: number }>,
    };
    for (const col of COLUMNS) s.perPlatform[col.platform] = { none: 0, one: 0, two: 0, three: 0 };
    for (const c of scoped) {
      for (const col of COLUMNS) {
        const p = c.platforms[col.platform];
        s.totalCells++;
        if (!p) { s.none++; s.perPlatform[col.platform].none++; continue; }
        if (!p.hasLink) { s.none++; s.perPlatform[col.platform].none++; }
        else if (!p.hasData) { s.oneCheck++; s.perPlatform[col.platform].one++; }
        else if (!p.upToDate) { s.twoChecks++; s.perPlatform[col.platform].two++; }
        else { s.threeChecks++; s.perPlatform[col.platform].three++; }
      }
    }
    return s;
  })();

  const visible = !clients
    ? []
    : filter === "all"
      ? scoped
      : filter === "perfect"
        ? scoped.filter((c) =>
            // Every column has 3 checks: has link + has data + up to date.
            COLUMNS.every((col) => {
              const p = c.platforms[col.platform];
              return !!p && p.hasLink && p.hasData && p.upToDate;
            })
          )
        : scoped.filter((c) => {
            // Less than 3 checks on at least one column.
            return COLUMNS.some((col) => {
              const p = c.platforms[col.platform];
              return !p || !p.upToDate;
            });
          });

  return (
    <div className="space-y-4">
      <Header
        title="Networks"
        subtitle="Per-company coverage — 1 check: link on file · 2 checks: data on file · 3 checks: data fresh (≤14d)"
        actions={
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        }
      />

      {stats && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Daily collection — at a glance</div>
            <div className="text-[10px] text-gray-400">{demoMode ? "DEMO numbers" : "live data"}</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard
              label="Got data in last 24h"
              value={stats.clientsWithData24h}
              total={stats.activeClients}
              tone="primary"
              caption="distinct companies"
            />
            <StatCard
              label="Got data this week"
              value={stats.clientsWithData7d}
              total={stats.activeClients}
              tone="ok"
              caption="last 7 days"
            />
            <StatCard
              label="Ever ingested"
              value={stats.clientsWithDataEver}
              total={stats.activeClients}
              tone="ok"
              caption="data on file at least once"
            />
            <StatCard
              label="Cells with link"
              value={stats.cellsWithLink}
              total={stats.totalCells}
              tone="neutral"
              caption={`${stats.activeClients} × ${stats.platforms} platforms`}
            />
            <StatCard
              label="Cells fully fresh"
              value={stats.cellsFresh14d}
              total={stats.totalCells}
              tone="ok"
              caption="post in last 14 days"
            />
          </div>
        </div>
      )}

      {/* Category tabs — view the 3-check coverage by company category */}
      {clients && categoryTabs.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {categoryTabs.map((t) => {
            const active = catFilter === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setCatFilter(t.key)}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                  active
                    ? "bg-red-600 text-white"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {t.label}
                <span className={`ml-1.5 text-xs ${active ? "text-red-100" : "text-gray-400"}`}>{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-[10px] uppercase font-medium tracking-wide text-gray-600">Missing link</div>
            <div className="text-2xl font-bold text-gray-700 mt-1">{summary.none}</div>
            <div className="text-[10px] text-gray-500 mt-1">no checks</div>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50/60 p-3">
            <div className="text-[10px] uppercase font-medium tracking-wide text-green-700">Link only</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{summary.oneCheck}</div>
            <div className="text-[10px] text-green-600 mt-1 flex items-center gap-0.5">
              <Check size={11} strokeWidth={3} />
              one check
            </div>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-100/60 p-3">
            <div className="text-[10px] uppercase font-medium tracking-wide text-green-700">Has data, stale</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{summary.twoChecks}</div>
            <div className="text-[10px] text-green-700 mt-1 flex items-center gap-0.5">
              <Check size={11} strokeWidth={3} /><Check size={11} strokeWidth={3} />
              two checks
            </div>
          </div>
          <div className="rounded-xl border border-green-300 bg-green-100 p-3">
            <div className="text-[10px] uppercase font-medium tracking-wide text-green-800">Up to date</div>
            <div className="text-2xl font-bold text-green-800 mt-1">{summary.threeChecks}</div>
            <div className="text-[10px] text-green-800 mt-1 flex items-center gap-0.5">
              <Check size={11} strokeWidth={3} /><Check size={11} strokeWidth={3} /><Check size={11} strokeWidth={3} />
              three checks
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-lg font-medium ${filter === "all" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
        >
          All ({scoped.length})
        </button>
        <button
          onClick={() => setFilter("perfect")}
          className={`px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1 ${filter === "perfect" ? "bg-green-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
        >
          <span className="inline-flex items-center gap-0">
            <Check size={11} strokeWidth={3} /><Check size={11} strokeWidth={3} /><Check size={11} strokeWidth={3} />
          </span>
          All 3 checks
        </button>
        <button
          onClick={() => setFilter("issues")}
          className={`px-3 py-1.5 rounded-lg font-medium ${filter === "issues" ? "bg-amber-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}
        >
          Less than 3 checks
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading networks coverage…
        </div>
      )}

      {error && (
        <div className="mx-auto max-w-md mt-4 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto text-amber-600 mb-2" />
          <div className="text-sm font-semibold text-amber-900">Could not load networks</div>
          <div className="text-xs text-amber-800 mt-1">{error}</div>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}

      {clients && !error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Company</th>
                {COLUMNS.map((c) => (
                  <th key={c.platform} className="text-center px-3 py-2 font-medium text-gray-500 text-xs border-l border-gray-100">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-6 py-12 text-center text-sm text-gray-400">
                    {filter === "issues"
                      ? "Every company has 3 checks on every platform — nothing to fix."
                      : filter === "perfect"
                        ? "No company has 3 checks across every platform yet."
                        : "No companies."}
                  </td>
                </tr>
              )}
              {visible.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 group">
                  <td className="px-4 py-2 align-top">
                    <Link
                      href={`/clients/${c.id}`}
                      className="block group-hover:underline"
                    >
                      <div className="font-medium text-gray-900 text-sm group-hover:text-blue-700">{c.name}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{c.clientType.toLowerCase()} — open dashboard →</div>
                    </Link>
                    {c.website && (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-700 mt-1"
                        title={c.website}
                      >
                        <ExternalLink size={9} />
                        {c.website.replace(/^https?:\/\/(?:www\.)?/, "").replace(/\/.*$/, "")}
                      </a>
                    )}
                  </td>
                  {COLUMNS.map((col) => {
                    const p = c.platforms[col.platform];
                    return <td key={col.platform} className="align-top p-0"><ChecksCell p={p} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[11px] text-gray-400 italic">
        Hover any cell to see the source URL, post count, and time since the most recent post.
      </div>
    </div>
  );
}


function StatCard({
  label, value, total, tone, caption,
}: {
  label: string;
  value: number;
  total: number;
  tone: "primary" | "ok" | "neutral" | "warn";
  caption?: string;
}) {
  const pct = total > 0 ? Math.round((100 * value) / total) : 0;
  const toneCls =
    tone === "primary" ? "bg-red-50 border-red-200 text-red-800"
    : tone === "ok"    ? "bg-green-50 border-green-200 text-green-800"
    : tone === "warn"  ? "bg-amber-50 border-amber-200 text-amber-800"
    : "bg-gray-50 border-gray-200 text-gray-800";
  return (
    <div className={`rounded-xl border p-3 ${toneCls}`}>
      <div className="text-[10px] uppercase font-medium tracking-wide opacity-80">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs opacity-70">/ {total}</div>
        <div className="text-xs font-semibold ml-auto opacity-80">{pct}%</div>
      </div>
      {caption && <div className="text-[10px] opacity-60 mt-0.5">{caption}</div>}
    </div>
  );
}
