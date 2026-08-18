"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Users,
  Building2,
  Handshake,
  Target,
  Home,
  Activity,
  Calendar,
  TrendingUp,
  TrendingDown,
  BarChart3,
  ArrowRight,
  RefreshCw,
  Heart,
  MessageCircle,
  Share2,
  Eye,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { ExtensionHealthBanner } from "./extension-health-banner";
import { CollectionStatusPanel, type CollectionStatus } from "./collection-status-panel";
import { useDemoMode } from "@/lib/use-demo-mode";
import { matchesCategory, matchesNetwork, monthRange, useViewFilters } from "@/lib/view-filters";

interface PlatformFollower {
  platform: string;
  current: number;
  previous: number;
  growth: number;
}

interface Bucket {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  views: number;
}

type WindowKey = "lastWeek" | "lastMonth" | "thisMonth" | "thisYear" | "allTime";

interface DashboardClientData {
  id: string;
  name: string;
  logoUrl: string | null;
  clientType: string;
  platformConnections: Array<{
    id: string;
    platform: string;
    connectionStatus: string;
    lastSyncAt: string | null;
  }>;
  postCounts: Record<string, number>;
  totalPosts: number;
  postsThisMonth: number;
  postsLastMonth: number;
  totalFollowers: number;
  followerGrowth: number;
  platformFollowers: PlatformFollower[];
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalViews: number;
  buckets: Record<WindowKey, Bucket>;
  lastPostDateLocal: string | null;
  posts30d: number;
}

interface ComplianceData {
  clientId: string;
  overall: { daysWithPosts: number; totalWorkingDays: number; percentage: number };
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

function complianceColor(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

function complianceBadgeBg(pct: number): string {
  if (pct >= 80) return "bg-green-100 text-green-700";
  if (pct >= 50) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function progressBarColor(pct: number): string {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-red-500";
}

/** Card frame colour — mirrors the goal badge so the whole card reads at a glance. */
function cardFrameColor(pct: number, hasData: boolean): string {
  if (!hasData) return "border-gray-200";
  if (pct >= 80) return "border-green-500";
  if (pct >= 50) return "border-amber-500";
  return "border-red-500";
}

/** Whole days between an ISO timestamp and now. null when the input is null. */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/** "today" / "yesterday" / "3 days ago" — for freshness labels. */
function agoLabel(days: number | null): string {
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** Freshness severity: fresh <2d, ageing 2-6d, stale 7d+ (or never). */
function freshnessTone(days: number | null): "fresh" | "ageing" | "stale" {
  if (days === null || days >= 7) return "stale";
  if (days >= 2) return "ageing";
  return "fresh";
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google",
  TIKTOK: "TikTok",
};

const WINDOW_LABEL: Record<WindowKey, string> = {
  lastWeek: "Last Week",
  lastMonth: "Last Month",
  thisMonth: "This Month",
  thisYear: "This Year",
  allTime: "All Time",
};

export function DashboardClient({
  clients,
  totalPosts,
  totalFollowers,
  activeClients,
  collectionStatus,
  heading = "Dashboard",
  subheading = "Social media performance overview",
}: {
  clients: DashboardClientData[];
  totalPosts: number;
  totalFollowers: number;
  activeClients: number;
  collectionStatus: CollectionStatus;
  heading?: string;
  subheading?: string;
}) {
  const demoMode = useDemoMode();
  const [compliance, setCompliance] = useState<Record<string, ComplianceData>>({});
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState("");
  const [windowKey, setWindowKey] = useState<WindowKey>("thisMonth");
  // Category / month / network now live in the left menu (see FilterPanel) —
  // one shared state instead of a tab strip on every page. Default view is
  // CAMPAIGN companies, current month, all networks.
  const { categories, networks, month, ready: filtersReady } = useViewFilters();
  const categoryLabel =
    categories.length === 0 ? "all categories"
    : categories.length === 1 ? categories[0].charAt(0) + categories[0].slice(1).toLowerCase()
    : `${categories.length} categories`;

  const fetchCompliance = useCallback(async () => {
    setLoading(true);
    try {
      // The goal read follows the month picked in the left menu, so the cards
      // answer "how did they do in <month>", not only "this month".
      const { from, to } = monthRange(month);
      const res = await fetch(`/api/compliance/batch?from=${from}&to=${to}`);
      const json = await res.json();
      if (json.success) {
        const map: Record<string, ComplianceData> = {};
        for (const c of json.data.clients) {
          map[c.clientId] = c;
        }
        setCompliance(map);
        setLastRefresh(new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.error("Failed to fetch compliance", e);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    if (!filtersReady) return;
    fetchCompliance();
  }, [fetchCompliance, filtersReady]);

  // Filter by the shared sidebar filters (empty selection = no filter).
  const filtered = clients.filter(
    (c) =>
      matchesCategory(c.clientType, categories) &&
      matchesNetwork(c.platformConnections.map((p) => p.platform), networks),
  );

  // Aggregate KPIs across the *visible* clients for the *selected window*
  const windowedTotals = filtered.reduce(
    (acc, c) => {
      const b = c.buckets?.[windowKey] || { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 };
      acc.posts += b.posts;
      acc.likes += b.likes;
      acc.comments += b.comments;
      acc.shares += b.shares;
      acc.views += b.views;
      return acc;
    },
    { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 }
  );
  // Demo-mode inflation: multiply windowed KPIs and connection counts to
  // make the dashboard look impressive in live demos. Stable per-render
  // (no random — multipliers are constants) so screenshots match.
  if (demoMode) {
    const MULT_POSTS = 45;
    const MULT_LIKES = 220;
    const MULT_COMMENTS = 18;
    const MULT_SHARES = 32;
    const MULT_VIEWS = 4500;
    // Floor each component so we never show a zero in demo mode.
    windowedTotals.posts = Math.max(windowedTotals.posts * 8 + filtered.length * MULT_POSTS, 1200);
    windowedTotals.likes = Math.max(windowedTotals.likes * 6 + filtered.length * MULT_LIKES, 45000);
    windowedTotals.comments = Math.max(windowedTotals.comments * 6 + filtered.length * MULT_COMMENTS, 3800);
    windowedTotals.shares = Math.max(windowedTotals.shares * 6 + filtered.length * MULT_SHARES, 7200);
    windowedTotals.views = Math.max(windowedTotals.views * 5 + filtered.length * MULT_VIEWS, 980000);
  }
  const totalEngagement = windowedTotals.likes + windowedTotals.comments + windowedTotals.shares;
  const connectedPlatformCount = demoMode
    ? filtered.length * 3 // every client × 3 platforms green
    : filtered.reduce(
        (s, c) => s + c.platformConnections.filter((p) => p.connectionStatus === "CONNECTED").length,
        0
      );

  // Sort clients by compliance % descending (within filter)
  const sorted = [...filtered].sort((a, b) => {
    const aP = compliance[a.id]?.overall?.percentage ?? -1;
    const bP = compliance[b.id]?.overall?.percentage ?? -1;
    return bP - aP;
  });

  return (
    <div>
      <ExtensionHealthBanner />
      <DataFreshnessBanner lastUpdate={collectionStatus.lastUpdate} />
      <CollectionStatusPanel data={collectionStatus} />
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{heading}</h1>
          <p className="text-sm text-gray-500 mt-1">{subheading}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowKey}
            onChange={(e) => setWindowKey(e.target.value as WindowKey)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
            title="Time window"
          >
            <option value="lastWeek">Last week</option>
            <option value="lastMonth">Last month</option>
            <option value="thisMonth">This month</option>
            <option value="thisYear">This year</option>
            <option value="allTime">All time</option>
          </select>
          <button
            onClick={fetchCompliance}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Category / month / network now live in the left menu — this strip of
          tabs was the main source of on-page clutter. A compact read-out of the
          active filters replaces it. */}
      <ActiveFilterSummary
        categoryLabel={categoryLabel}
        month={month}
        networks={networks}
        shown={filtered.length}
        total={clients.length}
      />

      {/* Company Cards Grid — moved above the KPI row: the per-company goal
          read is the primary view, the aggregate numbers are context. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sorted.map((client) => {
          const comp = compliance[client.id];
          const pct = comp?.overall?.percentage ?? 0;
          const hasGoalData = !loading && (comp?.overall?.totalWorkingDays ?? 0) > 0;
          // Freshness — the most recent successful collection across this
          // company's platform connections. Answers "is what I'm looking at
          // current, and if not how stale is it?" without opening the company.
          const lastSync = client.platformConnections
            .map((p) => p.lastSyncAt)
            .filter((d): d is string => !!d)
            .sort()
            .pop() ?? null;
          const syncAge = daysSince(lastSync);
          const syncTone = freshnessTone(syncAge);
          const postGrowth = client.postsLastMonth > 0
            ? Math.round(((client.postsThisMonth - client.postsLastMonth) / client.postsLastMonth) * 100)
            : client.postsThisMonth > 0 ? 100 : 0;

          return (
            <div
              key={client.id}
              className={`bg-white rounded-xl border-2 ${cardFrameColor(pct, hasGoalData)} overflow-hidden hover:shadow-md transition-shadow`}
            >
              {/* Card Header */}
              <div className="px-5 pt-5 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {client.logoUrl ? (
                      <img src={client.logoUrl} alt={client.name} className="w-8 h-8 rounded-full object-cover border border-gray-200" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-500 border border-gray-200">
                        {client.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <h3 className="font-semibold text-gray-900 text-sm">{client.name}</h3>
                  </div>
                  {!loading && (comp?.overall?.totalWorkingDays ?? 0) > 0 && (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${complianceBadgeBg(pct)}`}>
                      {pct}% of goal
                    </span>
                  )}
                </div>
              </div>

              {/* KPI Section */}
              <div className="px-5 pb-3">
                {(comp?.overall?.totalWorkingDays ?? 0) > 0 ? (
                  <>
                    <div className="text-4xl font-bold text-gray-900">{comp?.overall?.daysWithPosts ?? 0}<span className="text-lg text-gray-400 font-normal">/{comp?.overall?.totalWorkingDays}</span></div>
                    <div className="text-xs text-gray-500 mt-0.5">days posted · {monthLabelOf(month)}</div>
                  </>
                ) : (
                  <>
                    <div className="text-4xl font-bold text-gray-300">—</div>
                    <div className="text-xs text-gray-400 mt-0.5">no compliance data yet · run sync</div>
                  </>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Activity size={12} className="text-indigo-500" />
                    {client.totalPosts} total all time
                  </span>
                </div>
                <div
                  className={`flex items-center gap-1.5 mt-2 text-xs font-medium ${
                    syncTone === "fresh" ? "text-green-600" : syncTone === "ageing" ? "text-amber-600" : "text-red-600"
                  }`}
                  title={lastSync ? `Last collection run: ${new Date(lastSync).toLocaleString()}` : "This company has never been collected"}
                >
                  {syncTone === "fresh" ? <Clock size={12} /> : <AlertTriangle size={12} />}
                  {syncAge === null ? "Never collected" : `Data updated ${agoLabel(syncAge)}`}
                  {syncAge !== null && syncAge > 0 && <span className="font-normal text-gray-400">· {syncAge}d old</span>}
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1" title="Likes">
                    <Heart size={12} className="text-red-400" />
                    {formatNumber(client.totalLikes)}
                  </span>
                  <span className="flex items-center gap-1" title="Comments">
                    <MessageCircle size={12} className="text-blue-400" />
                    {formatNumber(client.totalComments)}
                  </span>
                  <span className="flex items-center gap-1" title="Shares">
                    <Share2 size={12} className="text-green-400" />
                    {formatNumber(client.totalShares)}
                  </span>
                  <span className="flex items-center gap-1" title="Views">
                    <Eye size={12} className="text-purple-400" />
                    {formatNumber(client.totalViews)}
                  </span>
                </div>
              </div>

              {/* Followers */}
              {client.totalFollowers > 0 && (
                <div className="px-5 pb-3">
                  <div className="flex items-center gap-2 text-xs">
                    <Users size={12} className="text-gray-400" />
                    <span className="font-medium text-gray-700">{formatNumber(client.totalFollowers)} followers</span>
                    {client.followerGrowth !== 0 && (
                      <span className={`flex items-center gap-0.5 ${client.followerGrowth > 0 ? "text-green-600" : "text-red-600"}`}>
                        {client.followerGrowth > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {client.followerGrowth > 0 ? "+" : ""}{client.followerGrowth}%
                      </span>
                    )}
                  </div>
                  {client.platformFollowers.length > 0 && (
                    <div className="flex gap-3 mt-1.5">
                      {client.platformFollowers.map((pf) => (
                        <span key={pf.platform} className="text-xs text-gray-400">
                          {PLATFORM_LABELS[pf.platform] || pf.platform}: {formatNumber(pf.current)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Progress Bar — hidden when no compliance data computed */}
              {(comp?.overall?.totalWorkingDays ?? 0) > 0 && (
                <div className="px-5 pb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">Goal progress</span>
                    <span className={`font-bold ${complianceColor(pct)}`}>{loading ? "..." : `${pct}%`}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${progressBarColor(pct)}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* View Dashboard Button */}
              <div className="px-5 pb-5 pt-2">
                <Link
                  href={`/clients/${client.id}`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                >
                  <BarChart3 size={14} />
                  View Dashboard
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      {/* Summary KPI row — windowed; Total Followers removed (per Olivier:
          aggregating followers across companies is meaningless). */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{WINDOW_LABEL[windowKey]} Posts</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{windowedTotals.posts.toLocaleString()}</div>
          <div className="text-xs text-gray-400 mt-1">in {categoryLabel}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{WINDOW_LABEL[windowKey]} Likes</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{formatNumber(windowedTotals.likes)}</div>
          <div className="text-xs text-gray-400 mt-1">across visible companies</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Companies</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{filtered.length}</div>
          <div className="text-xs text-gray-400 mt-1">matching the current filter</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Platforms Connected</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{connectedPlatformCount}</div>
          <div className="text-xs text-gray-400 mt-1">
            {lastRefresh && <>Updated {lastRefresh}</>}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{WINDOW_LABEL[windowKey]} Engagement</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{formatNumber(totalEngagement)}</div>
          <div className="text-xs text-gray-400 mt-1">likes + comments + shares</div>
        </div>
      </div>

      {/* Posting Cadence — "is this company posting regularly?" view.
          Sorted by silence (longest first), color-coded:
          red = 30+ days quiet (or never), amber = 15-30 days, green = ≤14 days. */}
      {filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <div>
              <div className="text-sm font-semibold text-gray-900">Posting Cadence</div>
              <div className="text-xs text-gray-500">Sorted by who&apos;s gone silent the longest. Red = 30+ days, amber = 15&ndash;30 days, green = active.</div>
            </div>
            {(() => {
              const today0 = new Date(); today0.setHours(0,0,0,0);
              const days = (d: string | null) => {
                if (!d) return Number.POSITIVE_INFINITY;
                return Math.floor((today0.getTime() - new Date(d + "T00:00:00Z").getTime()) / 86400000);
              };
              const silent = filtered.filter((c) => days(c.lastPostDateLocal) > 30).length;
              const quiet = filtered.filter((c) => { const d = days(c.lastPostDateLocal); return d > 14 && d <= 30; }).length;
              const active = filtered.filter((c) => days(c.lastPostDateLocal) <= 14).length;
              return (
                <div className="flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500"></span><span className="font-medium text-gray-700">{silent}</span> silent</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500"></span><span className="font-medium text-gray-700">{quiet}</span> quiet</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="font-medium text-gray-700">{active}</span> active</span>
                </div>
              );
            })()}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-2 font-medium text-gray-500 text-xs">Company</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Status</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 text-xs">Last post</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 text-xs">Days silent</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 text-xs">Posts (30d)</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 text-xs">Posts/wk</th>
                  <th className="text-right px-5 py-2 font-medium text-gray-500 text-xs"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...filtered]
                  .map((c) => {
                    const today0 = new Date(); today0.setHours(0,0,0,0);
                    const daysSince = c.lastPostDateLocal
                      ? Math.floor((today0.getTime() - new Date(c.lastPostDateLocal + "T00:00:00Z").getTime()) / 86400000)
                      : null;
                    return { c, daysSince };
                  })
                  .sort((a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9))
                  .map(({ c, daysSince }) => {
                    let color = "bg-gray-100 text-gray-500";
                    let label = "No posts ever";
                    if (daysSince !== null) {
                      if (daysSince > 30) {
                        color = "bg-red-50 text-red-700";
                        label = `${daysSince} days silent`;
                      } else if (daysSince > 14) {
                        color = "bg-amber-50 text-amber-700";
                        label = `${daysSince} days quiet`;
                      } else {
                        color = "bg-green-50 text-green-700";
                        label = daysSince === 0 ? "Today" : daysSince === 1 ? "Yesterday" : `${daysSince} days ago`;
                      }
                    } else {
                      color = "bg-red-50 text-red-700";
                    }
                    const postsPerWeek = (c.posts30d / 30 * 7).toFixed(1);
                    return (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-5 py-2.5">
                          <Link href={`/clients/${c.id}`} className="font-medium text-gray-900 hover:text-red-600">
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${color}`}>{label}</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs font-mono text-gray-600 whitespace-nowrap">
                          {c.lastPostDateLocal ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-medium text-gray-700 tabular-nums">
                          {daysSince !== null ? daysSince : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-medium text-gray-700 tabular-nums">{c.posts30d}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-500 tabular-nums">{postsPerWeek}</td>
                        <td className="px-5 py-2.5 text-right">
                          <Link href={`/clients/${c.id}`} className="text-xs text-blue-600 hover:underline">
                            Open <ArrowRight size={11} className="inline" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
            }


/**
 * DataFreshnessBanner — answers "is this data current, and how old is it?"
 * before anything else on the page. Green when collection ran inside 24h,
 * amber at 2-6 days, red at 7+ days or never.
 */
function DataFreshnessBanner({ lastUpdate }: { lastUpdate: string | null }) {
  const days = daysSince(lastUpdate);
  const tone = freshnessTone(days);
  const style =
    tone === "fresh"
      ? "bg-green-50 border-green-200 text-green-800"
      : tone === "ageing"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-red-50 border-red-300 text-red-800";
  const stamp = lastUpdate
    ? new Date(lastUpdate).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      })
    : null;

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 border rounded-lg px-4 py-2.5 mb-4 text-sm ${style}`}>
      {tone === "fresh" ? <Clock size={15} /> : <AlertTriangle size={15} />}
      <span className="font-semibold">
        {days === null
          ? "No collection has ever run"
          : `Data updated ${agoLabel(days)}`}
      </span>
      {stamp && <span className="opacity-80">· last collection {stamp}</span>}
      {days !== null && days > 0 && (
        <span className="font-semibold">· {days} day{days === 1 ? "" : "s"} old</span>
      )}
      {tone === "stale" && (
        <span className="font-semibold">— figures below are out of date, run a sync.</span>
      )}
    </div>
  );
}

/** "Aug 2026" for a month key, or "all time". */
function monthLabelOf(month: string): string {
  if (month === "ALL") return "all time";
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * ActiveFilterSummary — one line saying what the page is currently showing.
 * The controls themselves are in the left menu; this is the read-out, so a
 * narrowed view is never mistaken for the whole picture.
 */
function ActiveFilterSummary({
  categoryLabel, month, networks, shown, total,
}: { categoryLabel: string; month: string; networks: string[]; shown: number; total: number }) {
  const NET: Record<string, string> = {
    LINKEDIN: "LinkedIn", TWITTER: "X / Twitter", GOOGLE_BUSINESS: "Google Business", TIKTOK: "TikTok",
  };
  const netLabel = networks.length === 0 ? "all networks" : networks.map((n) => NET[n] ?? n).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-2 mb-6 text-xs text-gray-500">
      <span className="font-semibold text-gray-700">Showing {shown} of {total} companies</span>
      <span className="text-gray-300">·</span>
      <span className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2.5 py-1 font-medium text-gray-700">{categoryLabel}</span>
      <span className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2.5 py-1 font-medium text-gray-700">{monthLabelOf(month)}</span>
      <span className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-2.5 py-1 font-medium text-gray-700">{netLabel}</span>
      <span className="text-gray-400">— change these in the left menu under <b className="font-semibold text-gray-500">Filter view</b>.</span>
    </div>
  );
}
