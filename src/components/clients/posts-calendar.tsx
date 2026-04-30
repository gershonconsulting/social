"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, ExternalLink } from "lucide-react";

interface CalendarDay {
  date: string;
  hasPost: boolean;
  postCount: number;
}

interface CalendarPost {
  id: string;
  platform: string;
  postUrl: string | null;
  postTextSnippet: string | null;
  publishedDateLocal: string;
}

export function PostsCalendar({ clientId, platform }: { clientId: string; platform?: string }) {
  const [calendar, setCalendar] = useState<CalendarDay[]>([]);
  const [postsByDate, setPostsByDate] = useState<Record<string, CalendarPost[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ months: "2" });
    if (platform) params.set("platform", platform);

    fetch(`/api/clients/${clientId}/posts?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setCalendar(data.data?.calendar ?? []);
        const byDate: Record<string, CalendarPost[]> = {};
        for (const p of (data.data?.posts ?? []) as CalendarPost[]) {
          if (!p.publishedDateLocal) continue;
          if (!byDate[p.publishedDateLocal]) byDate[p.publishedDateLocal] = [];
          byDate[p.publishedDateLocal].push(p);
        }
        setPostsByDate(byDate);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId, platform]);

  if (loading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-gray-400">
        Loading calendar…
      </div>
    );
  }

  // Group days by week (Mon-Sun rows) within each month
  const months = new Map<string, CalendarDay[]>();
  for (const day of calendar) {
    const monthKey = day.date.substring(0, 7); // YYYY-MM
    if (!months.has(monthKey)) months.set(monthKey, []);
    months.get(monthKey)!.push(day);
  }

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="space-y-6 px-6 py-4">
      {Array.from(months.entries()).map(([monthKey, days]) => {
        const [year, monthNum] = monthKey.split("-").map(Number);
        const monthName = monthNames[monthNum - 1];

        // Build 7-column grid aligned to day of week
        // getDay: 0=Sun, we want Mon=0
        const firstDate = new Date(days[0].date + "T12:00:00");
        const firstDow = (firstDate.getDay() + 6) % 7; // Mon=0
        const paddedDays: (CalendarDay | null)[] = Array(firstDow).fill(null).concat(days);

        // Fill to complete last week
        while (paddedDays.length % 7 !== 0) paddedDays.push(null);

        // Stats
        const totalDays = days.length;
        const daysWithPosts = days.filter((d) => d.hasPost).length;
        const daysMissing = totalDays - daysWithPosts;

        return (
          <div key={monthKey} className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">
                {monthName} {year}
              </h3>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-green-600 font-medium">{daysWithPosts} posted</span>
                <span className="text-red-500 font-medium">{daysMissing} missed</span>
                <span className="text-gray-400">
                  {totalDays > 0 ? Math.round((daysWithPosts / totalDays) * 100) : 0}%
                </span>
              </div>
            </div>

            {/* Day of week headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {dayLabels.map((d) => (
                <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {paddedDays.map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} className="aspect-square" />;
                }
                const dayNum = parseInt(day.date.split("-")[2], 10);
                const isToday = day.date === new Date().toISOString().split("T")[0];

                const dayPosts = postsByDate[day.date] || [];
                const linkablePost = dayPosts.find((p) => p.postUrl);
                const titleText = day.hasPost
                  ? `${day.date}: ${day.postCount} post(s)` +
                    (dayPosts.length
                      ? "\n\n" + dayPosts.map((p) => `• [${p.platform}] ${(p.postTextSnippet || "").slice(0, 80)}`).join("\n")
                      : "")
                  : `${day.date}: No post`;
                const cellClass = `aspect-square rounded-md flex flex-col items-center justify-center text-xs relative transition-colors
                      ${day.hasPost
                        ? "bg-green-50 border border-green-200 hover:bg-green-100"
                        : "bg-red-50 border border-red-200"
                      }
                      ${isToday ? "ring-2 ring-blue-400" : ""}
                    `;
                if (day.hasPost && linkablePost?.postUrl) {
                  return (
                    <a
                      key={day.date}
                      href={linkablePost.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cellClass + " group cursor-pointer"}
                      title={titleText}
                    >
                      <span className="text-[10px] font-medium text-green-700">{dayNum}</span>
                      <CheckCircle2 size={14} className="text-green-500 mt-0.5 group-hover:hidden" />
                      <ExternalLink size={14} className="text-green-700 mt-0.5 hidden group-hover:block" />
                      {day.postCount > 1 && (
                        <span className="absolute top-0.5 right-1 text-[9px] font-bold text-green-700 bg-white rounded-full px-1">
                          {day.postCount}
                        </span>
                      )}
                    </a>
                  );
                }
                return (
                  <div
                    key={day.date}
                    className={cellClass}
                    title={titleText}
                  >
                    <span className={`text-[10px] font-medium ${day.hasPost ? "text-green-700" : "text-red-600"}`}>
                      {dayNum}
                    </span>
                    {day.hasPost ? (
                      <CheckCircle2 size={14} className="text-green-500 mt-0.5" />
                    ) : (
                      <XCircle size={14} className="text-red-400 mt-0.5" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {calendar.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-8">
          No calendar data available. Run a sync to populate.
        </div>
      )}
    </div>
  );
}
