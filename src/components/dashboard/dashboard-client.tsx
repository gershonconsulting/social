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
  ChevronDown,
} from "lucide-react";



interface DashboardClient {
  id: string;
  name: string;
  clientType: string;
  platformConnections: Array<{
    id: string;
    platform: string;
    connectionStatus: string;
    lastSyncAt: string | null;
  }>;
  postCounts: Record<string, number>;
  totalPosts: number;
}

interface ComplianceData {
  clientId: string;
  overall: { daysWithPosts: number; totalWorkingDays: number; percentage: number };
  platforms: Array<{ platform: string; daysWithPosts: number; totalWorkingDays: number; percentage: number }>;
}

type Period = "week" | "month" | "quarter" | "all" | "custom";

const GROUP_CONFIG: Array<{ type: string; label: string; icon: string; color: string }> = [
  { type: "CLIENT", label: "Clients", icon: "users", color: "blue" },
  { type: "PARTNER", label: "Partners", icon: "handshake", color: "purple" },
  { type: "PROSPECT", label: "Prospects", icon: "target", color: "amber" },
  { type: "INTERNAL", label: "Internal", icon: "home", color: "green" },
];

function formatRelativeSimple(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getDateRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  switch (period) {
    case "week": {
      const d = new Date(now);
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday = start
      d.setDate(d.getDate() - diff);
      return { from: d.toISOString().split("T")[0], to: today };
    }
    case "month": {
      return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: today };
    }
    case "quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      const qStart = new Date(now.getFullYear(), qMonth, 1);
      return { from: qStart.toISOString().split("T")[0], to: today };
    }
    case "all": {
      return { from: "2025-01-01", to: today };
    }
    default:
      return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: today };
  }
}

function complianceColor(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

function complianceBg(pct: number): string {
  if (pct >= 80) return "bg-green-50";
  if (pct >= 50) return "bg-amber-50";
  return "bg-red-50";
}

export function DashboardClient({
  clients,
  totalPosts,
}: {
  clients: DashboardClient[];
  totalPosts: number;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const [compliance, setCompliance] = useState<Record<string, ComplianceData>>({});
  const [loading, setLoading] = useState(true);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [dateLabel, setDateLabel] = useState("");

  const fetchCompliance = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/compliance/batch?from=${from}&to=${to}`);
      const json = await res.json();
      if (json.success) {
        const map: Record<string, ComplianceData> = {};
        for (const c of json.data.clients) {
          map[c.clientId] = c;
        }
        setCompliance(map);
        setDateLabel(`${from} → ${to} · ${json.data.totalWorkingDays} working days`);
      }
    } catch (e) {
      console.error("Failed to fetch compliance", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (period === "custom") return;
    const { from, to } = getDateRange(period);
    fetchCompliance(from, to);
  }, [period, fetchCompliance]);

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      fetchCompliance(customFrom, customTo);
      setShowCustom(false);
    }
  };

  const grouped = GROUP_CONFIG.map((g) => ({
    ...g,
    clients: clients.filter((c) => c.clientType === g.type),
  }));

  const IconMap: Record<string, typeof Users> = { users: Users, handshake: Handshake, target: Target, home: Home };

  const periods: Array<{ key: Period; label: string }> = [
    { key: "week", label: "Last Week" },
    { key: "month", label: "Last Month" },
    { key: "quarter", label: "Last Quarter" },
    { key: "all", label: "All" },
    { key: "custom", label: "Custom Dates" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Social media overview · {clients.length} companies · {totalPosts} posts collected
        </p>
      </div>

      {/* Time period filter */}
      <div className="flex items-center gap-2 mb-6">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                if (p.key === "custom") {
                  setShowCustom(!showCustom);
                  setPeriod("custom");
                } else {
                  setPeriod(p.key);
                  setShowCustom(false);
                }
              }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                period === p.key
                  ? "bg-gray-800 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {loading && (
          <div className="text-xs text-gray-400 animate-pulse ml-2">Loading…</div>
        )}
      </div>

      {/* Custom date picker */}
      {showCustom && (
        <div className="flex items-center gap-3 mb-6 bg-white rounded-lg border border-gray-200 px-4 py-3">
          <label className="text-sm text-gray-500">From</label>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-sm"
          />
          <label className="text-sm text-gray-500">To</label>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-sm"
          />
          <button
            onClick={handleCustomApply}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Apply
          </button>
        </div>
      )}

      {/* Date range label */}
      {dateLabel && (
        <div className="text-xs text-gray-400 mb-4 flex items-center gap-1.5">
          <Calendar size={12} />
          {dateLabel}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {grouped.map((g) => {
          const bgMap: Record<string, string> = { blue: "bg-blue-50", purple: "bg-purple-50", amber: "bg-amber-50", green: "bg-green-50" };
          const textMap: Record<string, string> = { blue: "text-blue-600", purple: "text-purple-600", amber: "text-amber-600", green: "text-green-600" };
          const Icon = IconMap[g.icon];
          return (
            <div key={g.type} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className={`inline-flex p-2 rounded-lg ${bgMap[g.color]} mb-3`}>
                <Icon size={18} className={textMap[g.color]} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{g.clients.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">{g.label}</div>
            </div>
          );
        })}
      </div>

      {/* Grouped tables */}
      {grouped.map((g) => {
        if (g.clients.length === 0) return null;
        const borderMap: Record<string, string> = { blue: "border-blue-200", purple: "border-purple-200", amber: "border-amber-200", green: "border-green-200" };
        const headerBgMap: Record<string, string> = { blue: "bg-blue-50", purple: "bg-purple-50", amber: "bg-amber-50", green: "bg-green-50" };
        const headerTextMap: Record<string, string> = { blue: "text-blue-800", purple: "text-purple-800", amber: "text-amber-800", green: "text-green-800" };

        return (
          <div key={g.type} className={`bg-white rounded-xl border ${borderMap[g.color]} overflow-hidden mb-6`}>
            <div className={`px-6 py-3 ${headerBgMap[g.color]} border-b ${borderMap[g.color]}`}>
              <h2 className={`text-sm font-semibold ${headerTextMap[g.color]}`}>
                {g.label} ({g.clients.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-6 py-3 font-medium text-gray-500">Company</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Compliance</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Total Posts</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">LinkedIn</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">X / Twitter</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Google</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Connections</th>
                    <th className="text-right px-6 py-3 font-medium text-gray-500">Last Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {g.clients.map((client) => {
                    const comp = compliance[client.id];
                    const pct = comp?.overall?.percentage;
                    const connCount = client.platformConnections.length;
                    const activeConns = client.platformConnections.filter(
                      (c) => c.connectionStatus === "CONNECTED" || c.connectionStatus === "PENDING"
                    ).length;
                    const lastSync = client.platformConnections
                      .map((c) => c.lastSyncAt)
                      .filter(Boolean)
                      .sort()
                      .pop();

                    return (
                      <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <Link
                            href={`/clients/${client.id}`}
                            className="font-medium text-gray-900 hover:text-blue-600 inline-flex items-center gap-2"
                          >
                            <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 border border-gray-200">
                              {client.name.charAt(0).toUpperCase()}
                            </span>
                            {client.name}
                          </Link>
                        </td>
                        <td className="px-4 py-4 text-center">
                          {loading ? (
                            <span className="text-gray-300 animate-pulse">…</span>
                          ) : pct !== undefined ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-bold ${complianceColor(pct)} ${complianceBg(pct)}`}>
                              {pct}%
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {client.totalPosts > 0 ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
                              <Activity size={14} className="text-indigo-500" />
                              {client.totalPosts}
                            </span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {client.postCounts["LINKEDIN"] ? (
                            <span className="text-sm font-medium text-gray-700">{client.postCounts["LINKEDIN"]}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {client.postCounts["TWITTER"] ? (
                            <span className="text-sm font-medium text-gray-700">{client.postCounts["TWITTER"]}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {client.postCounts["GOOGLE_BUSINESS"] ? (
                            <span className="text-sm font-medium text-gray-700">{client.postCounts["GOOGLE_BUSINESS"]}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className={`text-xs font-medium ${activeConns === connCount && connCount > 0 ? "text-green-600" : "text-gray-400"}`}>
                            {activeConns}/{connCount}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-xs text-gray-400">
                            {lastSync ? formatRelativeSimple(lastSync) : "Never"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
