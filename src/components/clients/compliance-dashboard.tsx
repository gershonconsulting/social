"use client";
import { useState, useEffect } from "react";
import { List, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Minus } from "lucide-react";

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
};

const PLATFORM_COLORS: Record<string, string> = {
  LINKEDIN: "bg-blue-600",
  TWITTER: "bg-gray-900",
  GOOGLE_BUSINESS: "bg-amber-500",
  FACEBOOK: "bg-blue-500",
  INSTAGRAM: "bg-pink-500",
  YOUTUBE: "bg-red-600",
};

interface PlatformCompliance {
  platform: string;
  label: string;
  daysWithPosts: number;
  totalWorkingDays: number;
  percentage: number;
}

interface CalendarDay {
  date: string;
  dayOfWeek: number;
  isWorkingDay: boolean;
  platforms: Record<string, { hasPost: boolean; postCount: number }>;
}

interface ComplianceData {
  month: string;
  totalWorkingDays: number;
  overall: { daysWithPosts: number; totalWorkingDays: number; percentage: number };
  platforms: PlatformCompliance[];
  calendar: CalendarDay[];
}

function getComplianceColor(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-amber-500";
  return "text-red-500";
}

function getComplianceBg(pct: number): string {
  if (pct >= 80) return "bg-green-50 border-green-200";
  if (pct >= 50) return "bg-amber-50 border-amber-200";
  return "bg-red-50 border-red-200";
}

function getComplianceRingColor(pct: number): string {
  if (pct >= 80) return "#22c55e";
  if (pct >= 50) return "#f59e0b";
  return "#ef4444";
}

function CircularProgress({ percentage, size = 120, strokeWidth = 10 }: { percentage: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = getComplianceRingColor(percentage);

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ComplianceDashboard({ clientId, platforms }: { clientId: string; platforms: string[] }) {
  const [view, setView] = useState<"listing" | "calendar">("listing");
  const [data, setData] = useState<ComplianceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Month navigation
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );

  const navigateMonth = (delta: number) => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setSelectedMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  };

  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const isCurrentMonth = selectedMonth === currentMonthStr;
  const [selYear, selMonth] = selectedMonth.split("-").map(Number);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      let lastErr = "";
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(`/api/clients/${clientId}/compliance?month=${selectedMonth}`, { cache: "no-store" });
          const ct = r.headers.get("content-type") || "";
          if (!ct.includes("application/json")) {
            lastErr = `Server returned non-JSON (HTTP ${r.status})`;
          } else {
            const res = await r.json();
            if (!cancelled) {
              setData(res.data ?? null);
              setLoading(false);
              return;
            }
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : "Network error";
        }
        await new Promise((res) => setTimeout(res, 250 * (i + 1)));
      }
      if (!cancelled) {
        setError(lastErr || "Could not load compliance data");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, selectedMonth]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400 animate-pulse">
          Loading compliance data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center text-xs text-amber-800">
        Could not load compliance data: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No compliance data available yet for this month — run a sync from the button above.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Month selector + view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateMonth(-1)}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft size={16} className="text-gray-600" />
          </button>
          <h2 className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">
            {MONTH_NAMES[selMonth - 1]} {selYear}
          </h2>
          <button
            onClick={() => navigateMonth(1)}
            disabled={isCurrentMonth}
            className={`p-1.5 rounded-lg border border-gray-200 transition-colors ${
              isCurrentMonth ? "opacity-30 cursor-not-allowed" : "hover:bg-gray-50"
            }`}
          >
            <ChevronRight size={16} className="text-gray-600" />
          </button>
        </div>

        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            onClick={() => setView("listing")}
            className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
              view === "listing"
                ? "bg-blue-50 text-blue-700 border-r border-gray-200"
                : "text-gray-500 hover:bg-gray-50 border-r border-gray-200"
            }`}
          >
            <List size={13} />
            List
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${
              view === "calendar"
                ? "bg-blue-50 text-blue-700"
                : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            <CalendarDays size={13} />
            Calendar
          </button>
        </div>
      </div>

      {/* Hero compliance cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Overall big number */}
        <div className={`rounded-xl border p-5 flex flex-col items-center justify-center ${getComplianceBg(data.overall.percentage)}`}>
          <div className="relative">
            <CircularProgress percentage={data.overall.percentage} size={100} strokeWidth={8} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${getComplianceColor(data.overall.percentage)}`}>
                {data.overall.percentage}%
              </span>
            </div>
          </div>
          <div className="text-xs font-semibold text-gray-700 mt-2">Overall</div>
          <div className="text-[10px] text-gray-500">
            {data.overall.daysWithPosts}/{data.totalWorkingDays} working days
          </div>
        </div>

        {/* Per-platform cards */}
        {data.platforms.map((p) => (
          <div
            key={p.platform}
            className={`rounded-xl border p-5 flex flex-col items-center justify-center ${getComplianceBg(p.percentage)}`}
          >
            <div className="relative">
              <CircularProgress percentage={p.percentage} size={100} strokeWidth={8} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-bold ${getComplianceColor(p.percentage)}`}>
                  {p.percentage}%
                </span>
              </div>
            </div>
            <div className="text-xs font-semibold text-gray-700 mt-2">
              {PLATFORM_LABELS[p.platform] ?? p.platform}
            </div>
            <div className="text-[10px] text-gray-500">
              {p.daysWithPosts}/{p.totalWorkingDays} working days
            </div>
          </div>
        ))}
      </div>

      {/* Listing or Calendar view */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {view === "listing" ? (
          <ComplianceListing data={data} />
        ) : (
          <ComplianceCalendar data={data} />
        )}
      </div>
    </div>
  );
}

/* ─── Listing View ─────────────────────────────────────────────────── */

function ComplianceListing({ data }: { data: ComplianceData }) {
  const workingDays = data.calendar.filter((d) => d.isWorkingDay);
  const trackedPlatforms = data.platforms.map((p) => p.platform);

  if (workingDays.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-gray-400">
        No working days in this period yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left px-6 py-3 font-medium text-gray-500 text-xs">Date</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs">Day</th>
            {trackedPlatforms.map((p) => (
              <th key={p} className="text-center px-4 py-3 font-medium text-gray-500 text-xs">
                {PLATFORM_LABELS[p] ?? p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {workingDays.map((day) => {
            const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.dayOfWeek];
            const todayStr = new Date().toISOString().split("T")[0];
            const isToday = day.date === todayStr;

            return (
              <tr key={day.date} className={`hover:bg-gray-50 ${isToday ? "bg-blue-50/50" : ""}`}>
                <td className="px-6 py-3 text-xs font-mono text-gray-600 whitespace-nowrap">
                  {day.date}
                  {isToday && <span className="ml-2 text-blue-600 font-medium">Today</span>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">{dayName}</td>
                {trackedPlatforms.map((p) => {
                  const info = day.platforms[p];
                  if (!info) {
                    return (
                      <td key={p} className="px-4 py-3 text-center">
                        <Minus size={14} className="text-gray-300 mx-auto" />
                      </td>
                    );
                  }
                  return (
                    <td key={p} className="px-4 py-3 text-center">
                      {info.hasPost ? (
                        <div className="flex items-center justify-center gap-1">
                          <CheckCircle2 size={16} className="text-green-500" />
                          {info.postCount > 1 && (
                            <span className="text-[10px] text-green-600 font-medium">
                              x{info.postCount}
                            </span>
                          )}
                        </div>
                      ) : (
                        <XCircle size={16} className="text-red-400 mx-auto" />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Calendar View ────────────────────────────────────────────────── */

function ComplianceCalendar({ data }: { data: ComplianceData }) {
  const trackedPlatforms = data.platforms.map((p) => p.platform);
  const todayStr = new Date().toISOString().split("T")[0];

  // Build 7-column grid aligned to day of week
  // First day's dow: data.calendar[0].dayOfWeek, convert to Mon=0 index
  if (data.calendar.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-gray-400">
        No calendar data for this month yet.
      </div>
    );
  }

  const firstDow = (data.calendar[0].dayOfWeek + 6) % 7; // Mon=0
  const paddedDays: (CalendarDay | null)[] = Array(firstDow).fill(null).concat(data.calendar);
  while (paddedDays.length % 7 !== 0) paddedDays.push(null);

  return (
    <div className="p-6">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
        <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-green-500" /> Posted</span>
        <span className="flex items-center gap-1"><XCircle size={12} className="text-red-400" /> Missing</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 inline-block border border-gray-200" /> Weekend</span>
      </div>

      {/* Day of week headers */}
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {paddedDays.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="aspect-square" />;
          }
          const dayNum = parseInt(day.date.split("-")[2], 10);
          const isToday = day.date === todayStr;

          if (!day.isWorkingDay) {
            // Weekend — neutral gray
            return (
              <div
                key={day.date}
                className={`aspect-square rounded-md flex flex-col items-center justify-center bg-gray-50 border border-gray-100 ${isToday ? "ring-2 ring-blue-400" : ""}`}
                title={`${day.date} (Weekend)`}
              >
                <span className="text-[10px] font-medium text-gray-300">{dayNum}</span>
              </div>
            );
          }

          // Working day: check if ALL tracked platforms have posts
          const allPosted = trackedPlatforms.every((p) => day.platforms[p]?.hasPost);
          const somePosted = trackedPlatforms.some((p) => day.platforms[p]?.hasPost);
          const nonePosted = !somePosted;

          let bgClass = "bg-red-50 border-red-200";
          let icon = <XCircle size={14} className="text-red-400 mt-0.5" />;
          let textClass = "text-red-600";

          if (allPosted) {
            bgClass = "bg-green-50 border-green-200";
            icon = <CheckCircle2 size={14} className="text-green-500 mt-0.5" />;
            textClass = "text-green-700";
          } else if (somePosted) {
            bgClass = "bg-amber-50 border-amber-200";
            icon = <CheckCircle2 size={14} className="text-amber-500 mt-0.5" />;
            textClass = "text-amber-700";
          }

          // Platform dots
          const dots = trackedPlatforms.map((p) => {
            const has = day.platforms[p]?.hasPost;
            return (
              <span
                key={p}
                className={`w-1.5 h-1.5 rounded-full ${has ? PLATFORM_COLORS[p] || "bg-green-500" : "bg-gray-300"}`}
                title={`${PLATFORM_LABELS[p] ?? p}: ${has ? "Posted" : "Missing"}`}
              />
            );
          });

          return (
            <div
              key={day.date}
              className={`aspect-square rounded-md flex flex-col items-center justify-center border relative ${bgClass} ${isToday ? "ring-2 ring-blue-400" : ""}`}
              title={`${day.date}: ${trackedPlatforms.map((p) => `${PLATFORM_LABELS[p] ?? p}: ${day.platforms[p]?.hasPost ? "Posted" : "Missing"}`).join(", ")}`}
            >
              <span className={`text-[10px] font-medium ${textClass}`}>{dayNum}</span>
              {icon}
              <div className="flex gap-0.5 mt-0.5">
                {dots}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
