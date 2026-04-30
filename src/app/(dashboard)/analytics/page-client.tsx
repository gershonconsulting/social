"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, RefreshCw, ExternalLink, ThumbsUp, MessageCircle, Share2 } from "lucide-react";
import { Header } from "@/components/layout/header";

interface DayBucket {
  date: string;
  total: number;
  byPlatform: Record<string, number>;
}
interface PlatformTotals {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
}
interface TopPost {
  id: string;
  platform: string;
  clientName: string;
  clientId: string;
  postUrl: string | null;
  textSnippet: string | null;
  publishedDateLocal: string;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  totalEngagement: number;
}
interface Summary {
  days: number;
  since: string;
  totals: { posts: number; likes: number; comments: number; shares: number; engagement: number };
  postsByDay: DayBucket[];
  byPlatform: Record<string, PlatformTotals>;
  byCategory: Record<string, number>;
  topPosts: TopPost[];
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  GOOGLE_BUSINESS: "Google Business",
};

const PLATFORM_COLOR: Record<string, string> = {
  LINKEDIN: "bg-blue-500",
  TWITTER: "bg-gray-700",
  FACEBOOK: "bg-indigo-500",
  INSTAGRAM: "bg-pink-500",
  YOUTUBE: "bg-red-500",
  GOOGLE_BUSINESS: "bg-green-600",
};

const CATEGORY_LABEL: Record<string, string> = {
  CLIENT: "Client",
  PROSPECT: "Prospect",
  PARTNER: "Partner",
  COMPETITION: "Competition",
  COMPANY: "Company",
  INTERNAL: "Internal",
};

const RANGE_OPTIONS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

export function AnalyticsPageClient() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      let lastErr = "";
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`/api/analytics/summary?days=${days}`, { cache: "no-store" });
          if (!r.ok) {
            let body: { error?: string } | null = null;
            try { body = await r.json(); } catch {}
            lastErr = body?.error || `HTTP ${r.status}`;
          } else {
            const j = await r.json();
            if (!cancelled) {
              setData(j?.data ?? null);
              setLoading(false);
            }
            return;
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : "Network error";
        }
        await new Promise((res) => setTimeout(res, 250 * (i + 1)));
      }
      if (!cancelled) {
        setError(lastErr || "Could not load analytics");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days, attempt]);

  const maxDay = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.postsByDay.map((d) => d.total));
  }, [data]);

  return (
    <div className="space-y-8">
      <Header
        title="Analytics"
        subtitle="Cross-client posting volume, engagement, and category breakdown"
        actions={
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        }
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Loading analytics…
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-md mt-8 p-6 text-center bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={20} className="mx-auto text-amber-600 mb-2" />
          <div className="text-sm font-semibold text-amber-900">Could not load analytics</div>
          <div className="text-xs text-amber-800 mt-1">{error}</div>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Top KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <KpiCard label="Posts" value={data.totals.posts.toLocaleString()} />
            <KpiCard label="Likes" value={data.totals.likes.toLocaleString()} />
            <KpiCard label="Comments" value={data.totals.comments.toLocaleString()} />
            <KpiCard label="Shares" value={data.totals.shares.toLocaleString()} />
            <KpiCard label="Total Engagement" value={data.totals.engagement.toLocaleString()} highlight />
          </div>

          {/* Posts by day */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Posts per day</h2>
            {data.postsByDay.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">No posts in this window.</div>
            ) : (
              <div className="flex items-end gap-1 h-40">
                {data.postsByDay.map((d) => (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col justify-end group relative"
                    title={`${d.date}: ${d.total} posts`}
                  >
                    <div
                      className="bg-blue-500 hover:bg-blue-600 transition-colors rounded-t"
                      style={{ height: `${(d.total / maxDay) * 100}%`, minHeight: d.total ? 2 : 0 }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between text-[10px] text-gray-400 mt-2 font-mono">
              <span>{data.postsByDay[0]?.date ?? ""}</span>
              <span>{data.postsByDay[data.postsByDay.length - 1]?.date ?? ""}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By platform */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">By platform</h2>
              {Object.keys(data.byPlatform).length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No platform data.</div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(data.byPlatform)
                    .sort((a, b) => b[1].posts - a[1].posts)
                    .map(([platform, t]) => {
                      const totalEng = t.likes + t.comments + t.shares;
                      return (
                        <div key={platform}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium text-gray-700">
                              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${PLATFORM_COLOR[platform] ?? "bg-gray-400"}`} />
                              {PLATFORM_LABELS[platform] ?? platform}
                            </span>
                            <span className="text-gray-500">
                              {t.posts} posts · {totalEng.toLocaleString()} engagement
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* By category */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Companies by category</h2>
              {Object.keys(data.byCategory).length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No companies.</div>
              ) : (
                <div className="space-y-2 text-xs">
                  {Object.entries(data.byCategory)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, n]) => (
                      <div key={k} className="flex items-center justify-between">
                        <span className="text-gray-700">{CATEGORY_LABEL[k] ?? k}</span>
                        <span className="font-mono text-gray-500">{n}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Top posts */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Top 10 posts by engagement</h2>
            </div>
            {data.topPosts.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-gray-400">No posts in this window.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-6 py-2 font-medium text-gray-500 text-xs">Date</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Company</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Platform</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs">Post</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-500 text-xs"><ThumbsUp size={11} className="inline" /></th>
                    <th className="text-center px-4 py-2 font-medium text-gray-500 text-xs"><MessageCircle size={11} className="inline" /></th>
                    <th className="text-center px-4 py-2 font-medium text-gray-500 text-xs"><Share2 size={11} className="inline" /></th>
                    <th className="text-right px-6 py-2 font-medium text-gray-500 text-xs">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.topPosts.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-6 py-2 text-xs font-mono text-gray-600">{p.publishedDateLocal}</td>
                      <td className="px-4 py-2 text-xs">
                        <Link href={`/clients/${p.clientId}`} className="text-blue-600 hover:underline">
                          {p.clientName}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{PLATFORM_LABELS[p.platform] ?? p.platform}</td>
                      <td className="px-4 py-2 max-w-md">
                        <p className="text-xs text-gray-700 line-clamp-1">
                          {p.textSnippet || <span className="italic text-gray-400">No text</span>}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-center text-xs">{p.likeCount.toLocaleString()}</td>
                      <td className="px-4 py-2 text-center text-xs">{p.commentCount.toLocaleString()}</td>
                      <td className="px-4 py-2 text-center text-xs">{p.shareCount.toLocaleString()}</td>
                      <td className="px-6 py-2 text-right">
                        {p.postUrl ? (
                          <a href={p.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                            <ExternalLink size={11} />View
                          </a>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border ${highlight ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"} p-4`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? "text-blue-700" : "text-gray-900"}`}>{value}</div>
    </div>
  );
}
