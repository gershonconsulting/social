"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
};

const PLATFORM_COLORS: Record<string, string> = {
  LINKEDIN: "#0A66C2",
  TWITTER: "#000000",
  GOOGLE_BUSINESS: "#4285F4",
  FACEBOOK: "#1877F2",
  INSTAGRAM: "#E1306C",
};

interface Client { id: string; name: string }
interface FollowerSummary {
  count: number;
  date: string;
  previous7?: number;
  previous30?: number;
}

export default function FollowersPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [snapshots, setSnapshots] = useState<{ platform: string; snapshotDateLocal: string; followerCount: number }[]>([]);
  const [summary, setSummary] = useState<Record<string, FollowerSummary>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((d) => {
      if (d.success) setClients(d.data);
    });
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 30);
    fetch(
      `/api/followers?clientId=${selectedClientId}&dateFrom=${since.toISOString().slice(0, 10)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSnapshots(d.data.snapshots);
          setSummary(d.data.summary);
        }
      })
      .finally(() => setLoading(false));
  }, [selectedClientId]);

  // Build chart data — group by date
  const chartData: Record<string, Record<string, number>> = {};
  for (const snap of snapshots) {
    if (!chartData[snap.snapshotDateLocal]) chartData[snap.snapshotDateLocal] = {};
    chartData[snap.snapshotDateLocal][snap.platform] = snap.followerCount;
  }
  const chartArray = Object.entries(chartData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals }));

  const platforms = [...new Set(snapshots.map((s) => s.platform))];

  function trend(current: number, previous?: number) {
    if (previous === undefined) return null;
    const diff = current - previous;
    return diff;
  }

  return (
    <div>
      <Header title="Followers" subtitle="Daily follower count tracking per platform" />

      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-500 mb-1">Client</label>
        <select
          value={selectedClientId}
          onChange={(e) => setSelectedClientId(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {!selectedClientId && (
        <div className="text-center py-16 text-gray-400 text-sm">
          Select a client to view follower history.
        </div>
      )}

      {selectedClientId && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {Object.entries(summary).map(([platform, data]) => {
              const diff7 = trend(data.count, data.previous7);
              const diff30 = trend(data.count, data.previous30);
              return (
                <div key={platform} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    {PLATFORM_LABELS[platform] ?? platform}
                  </div>
                  <div className="text-3xl font-bold text-gray-900 mb-2">
                    {data.count.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {diff7 !== null && (
                      <span className={`flex items-center gap-0.5 ${diff7 >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {diff7 >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {diff7 >= 0 ? "+" : ""}{diff7.toLocaleString()} (7d)
                      </span>
                    )}
                    {diff30 !== null && (
                      <span className={`flex items-center gap-0.5 ${diff30 >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {diff30 >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {diff30 >= 0 ? "+" : ""}{diff30.toLocaleString()} (30d)
                      </span>
                    )}
                    {diff7 === null && <span className="text-gray-400">No trend data</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">As of {data.date}</div>
                </div>
              );
            })}
          </div>

          {/* Chart */}
          {chartArray.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">
                30-Day Follower Trend
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartArray}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
                  <Tooltip />
                  <Legend />
                  {platforms.map((p) => (
                    <Line
                      key={p}
                      type="monotone"
                      dataKey={p}
                      name={PLATFORM_LABELS[p] ?? p}
                      stroke={PLATFORM_COLORS[p] ?? "#6b7280"}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Raw data table */}
          {snapshots.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">Follower History</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-6 py-3 font-medium text-gray-500">Date</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Platform</th>
                      <th className="text-right px-6 py-3 font-medium text-gray-500">Followers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...snapshots]
                      .sort((a, b) => b.snapshotDateLocal.localeCompare(a.snapshotDateLocal))
                      .slice(0, 100)
                      .map((snap, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-6 py-2.5 font-mono text-xs text-gray-500">{snap.snapshotDateLocal}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-700">
                            {PLATFORM_LABELS[snap.platform] ?? snap.platform}
                          </td>
                          <td className="px-6 py-2.5 text-right font-semibold text-gray-900">
                            {snap.followerCount.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              No follower data yet. Run a sync to collect follower snapshots.
            </div>
          )}
        </>
      )}
    </div>
  );
}
