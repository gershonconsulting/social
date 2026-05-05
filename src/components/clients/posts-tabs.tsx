"use client";
import { useState } from "react";
import { List, CalendarDays } from "lucide-react";
import { PostsListing } from "./posts-listing";
import { PostsCalendar } from "./posts-calendar";

const PLATFORM_OPTIONS = [
  { value: "", label: "All Platforms" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "TWITTER", label: "X / Twitter" },
];

export function PostsTabs({ clientId, platforms }: { clientId: string; platforms: string[] }) {
  const [view, setView] = useState<"listing" | "calendar">("listing");
  const [platform, setPlatform] = useState("");

  // Filter platform options to only show platforms this client has
  const availablePlatforms = PLATFORM_OPTIONS.filter(
    (p) => p.value === "" || platforms.includes(p.value)
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Posts — Last 2 Months</h2>
        <div className="flex items-center gap-3">
          {/* Platform filter */}
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white"
          >
            {availablePlatforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          {/* View toggle */}
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
      </div>

      {view === "listing" ? (
        <PostsListing clientId={clientId} platform={platform || undefined} />
      ) : (
        <PostsCalendar clientId={clientId} platform={platform || undefined} />
      )}
    </div>
  );
}
