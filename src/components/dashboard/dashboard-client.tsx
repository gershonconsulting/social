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
} from "lucide-react";
import { ExtensionHealthBanner } from "./extension-health-banner";
import { CollectionStatusPanel, type CollectionStatus } from "./collection-status-panel";
import { useDemoMode } from "@/lib/use-demo-mode";

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
}: {
  clients: DashboardClientData[];
  totalPosts: number;
  totalFollowers: number;
  activeClients: number;
  collectionStatus: CollectionStatus;
}) {
  const demoMode = useDemoMode();
  const [compliance, setCompliance] = useState<Record<string, ComplianceData>>({});
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState("");
  const [windowKey, setWindowKey] = useState<WindowKey>("thisMonth");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [platformFilter, setPlatformFilter] = useState<string>("ALL");

  const fetchCompliance = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const to = now.toISOString().split("T")[0];
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
  }, []);

  useEffect(() => {
    fetchCompliance();
  }, [fetchCompliance]);

  // Filter by category AND platform tabs
  const filtered = clients.filter((c) => {
    if (categoryFilter !== "ALL" && (c.clientType ?? "").toUpperCase() !== categoryFilter) return false;
    if (platformFilter !== "ALL") {
      const has = c.platformConnections.some((p) => p.platform === platformFilter);
      if (!has) return false;
    }
    return true;
  });

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
      <CollectionStatusPanel data={collectionStatus} />
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Social media performance overview</p>
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

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5 mb-6 border-b border-gray-200 pb-3">
        {[
          { key: "ALL", label: "All" },
          { key: "CAMPAIGN", label: "Campaign" },
          { key: "CLIENT", label: "Client" },
          { key: "PROSPECT", label: "Prospect" },
          { key: "PARTNER", label: "Partner" },
          { key: "COMPETITION", label: "Competition" },
          { key: "INTERNAL", label: "Internal" },
          { key: "RECYCLED", label: "Recycled" },
        ].map((t) => {
          const count = t.key === "ALL"
            ? clients.length
            : clients.filter((c) => (c.clientType ?? "").toUpperCase() === t.key).length;
          const active = categoryFilter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setCategoryFilter(t.key)}
              className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                active
                  ? "bg-red-600 text-white"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-xs ${active ? "text-red-100" : "text-gray-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Platform filter — shown alongside the time-window selector for fast slicing */}
      <div className="flex flex-wrap gap-1.5 mb-6 -mt-2">
        {[
          { key: "ALL", label: "All platforms" },
          { key: "LINKEDIN", label: "LinkedIn" },
          { key: "TWITTER", label: "X / Twitter" },
          { key: "GOOGLE_BUSINESS", label: "Google Business" },
        ].map((p) => {
          const count = p.key === "ALL"
            ? clients.length
            : clients.filter((c) => c.platformConnections.some((pc) => pc.platform === p.key)).length;
          const active = platformFilter === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setPlatformFilter(p.key)}
              className={`px-3 py-1.5 text-xs rounded-full transition-colors ${
                active
                  ? "bg-gray-800 text-white"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {p.label}
              <span className={`ml-1.5 ${active ? "text-gray-300" : "text-gray-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Summary KPI row — windowed; Total Followers removed (per Olivier:
          aggregating followers across companies is meaningless). */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{WINDOW_LABEL[windowKey]} Posts</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{windowedTotals.posts.toLocaleString()}</div>
          <div className="text-xs text-gray-400 mt-1">{categoryFilter === "ALL" ? "across all categories" : `in ${categoryFilter.charAt(0) + categoryFilter.slice(1).toLowerCase()}`}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{WINDOW_LABEL[windowKey]} Likes</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{formatNumber(windowedTotals.likes)}</div>
          <div className="text-xs text-gray-400 mt-1">across visible companies</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Companies</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{filtered.length}</div>
          <div className="text-xs text-gray-400 mt-1">in the selected category</div>
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

      {/* Company Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {sorted.map((client) => {
          const comp = compliance[client.id];
          const pct = comp?.overall?.percentage ?? 0;
          const postGrowth = client.postsLastMonth > 0
            ? Math.round(((client.postsThisMonth - client.postsLastMonth) / client.postsLastMonth) * 100)
            : client.postsThisMonth > 0 ? 100 : 0;

          return (
            <div key={client.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
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
                    <div className="text-xs text-gray-500 mt-0.5">days posted this month</div>
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
    </div>
  );
            }
