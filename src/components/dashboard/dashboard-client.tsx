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

interface PlatformFollower {
  platform: string;
  current: number;
  previous: number;
  growth: number;
}

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
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
};

export function DashboardClient({
  clients,
  totalPosts,
  totalFollowers,
  activeClients,
}: {
  clients: DashboardClientData[];
  totalPosts: number;
  totalFollowers: number;
  activeClients: number;
}) {
  const [compliance, setCompliance] = useState<Record<string, ComplianceData>>({});
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState("");

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

  const totalPostsThisMonth = clients.reduce((s, c) => s + c.postsThisMonth, 0);
    const totalDaysPosted = Object.values(compliance).reduce((s, c) => s + (c.overall?.daysWithPosts ?? 0), 0);
    const totalWorkingDays = Object.values(compliance).length > 0 ? (Object.values(compliance)[0]?.overall?.totalWorkingDays ?? 0) : 0;
  const totalEngagement = clients.reduce((s, c) => s + c.totalLikes + c.totalComments + c.totalShares, 0);

  // Sort clients by compliance % descending
  const sorted = [...clients].sort((a, b) => {
    const aP = compliance[a.id]?.overall?.percentage ?? -1;
    const bP = compliance[b.id]?.overall?.percentage ?? -1;
    return bP - aP;
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Social media performance overview</p>
        </div>
        <button
          onClick={fetchCompliance}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Summary KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Posts This Month</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{totalPostsThisMonth}</div>
          <div className="text-xs text-gray-400 mt-1">{totalPosts} total all time</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Followers</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{formatNumber(totalFollowers)}</div>
          <div className="text-xs text-gray-400 mt-1">across all platforms</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Active Companies</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{activeClients}</div>
          <div className="text-xs text-gray-400 mt-1">being tracked</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Platforms Connected</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">
            {clients.reduce((s, c) => s + c.platformConnections.filter(p => p.connectionStatus === "CONNECTED").length, 0)}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {lastRefresh && <>Updated {lastRefresh}</>}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Engagement</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{formatNumber(totalEngagement)}</div>
          <div className="text-xs text-gray-400 mt-1">likes + comments + shares</div>
        </div>
      </div>

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
                  {!loading && (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${complianceBadgeBg(pct)}`}>
                      {pct}% of goal
                    </span>
                  )}
                </div>
              </div>

              {/* KPI Section */}
              <div className="px-5 pb-3">
                <div className="text-4xl font-bold text-gray-900">{comp?.overall?.daysWithPosts ?? 0}<span className="text-lg text-gray-400 font-normal">/{comp?.overall?.totalWorkingDays ?? 0}</span></div>
                <div className="text-xs text-gray-500 mt-0.5">days posted this month</div>
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

              {/* Progress Bar */}
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
