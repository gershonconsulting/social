"use client";

import { useState, useEffect } from "react";
import { Hash, TrendingUp, Lightbulb, RefreshCw } from "lucide-react";

interface HashtagData {
  tag: string;
  count: number;
  lastUsed: string;
}

interface HashtagCloudProps {
  clientId: string;
}

export function HashtagCloud({ clientId }: HashtagCloudProps) {
  const [hashtags, setHashtags] = useState<HashtagData[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/hashtags`)
      .then((r) => r.json())
      .then((data) => {
        setHashtags(data.hashtags || []);
        setSuggestions(data.suggestions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-100 rounded w-40" />
          <div className="flex flex-wrap gap-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-7 bg-gray-100 rounded-full w-20" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (hashtags.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-2">
          <Hash className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Hashtags</h3>
        </div>
        <p className="text-sm text-gray-500">No hashtags found. Sync posts to collect hashtag data.</p>
      </div>
    );
  }

  const maxCount = Math.max(...hashtags.map((h) => h.count));

  function getTagSize(count: number): string {
    const ratio = count / maxCount;
    if (ratio > 0.7) return "text-lg font-bold";
    if (ratio > 0.4) return "text-base font-semibold";
    if (ratio > 0.2) return "text-sm font-medium";
    return "text-xs";
  }

  function getTagColor(count: number): string {
    const ratio = count / maxCount;
    if (ratio > 0.7) return "bg-red-50 text-red-700 border-red-200";
    if (ratio > 0.4) return "bg-blue-50 text-blue-700 border-blue-200";
    if (ratio > 0.2) return "bg-teal-50 text-teal-700 border-teal-200";
    return "bg-gray-50 text-gray-600 border-gray-200";
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">
            Hashtags ({hashtags.length})
          </h3>
        </div>
        {suggestions.length > 0 && (
          <button
            onClick={() => setShowSuggestions(!showSuggestions)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            {showSuggestions ? "Hide" : "Show"} Suggestions ({suggestions.length})
          </button>
        )}
      </div>

      {/* Hashtag cloud */}
      <div className="flex flex-wrap gap-2 mb-4">
        {hashtags.map((h) => (
          <span
            key={h.tag}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${getTagColor(h.count)} ${getTagSize(h.count)} transition-transform hover:scale-105`}
            title={`Used ${h.count} time${h.count !== 1 ? "s" : ""} — last: ${new Date(h.lastUsed).toLocaleDateString()}`}
          >
            #{h.tag}
            <span className="text-[10px] opacity-60">×{h.count}</span>
          </span>
        ))}
      </div>

      {/* Top hashtags table */}
      {hashtags.length > 3 && (
        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">Top Hashtags</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {hashtags.slice(0, 6).map((h, i) => (
              <div key={h.tag} className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 w-4">{i + 1}.</span>
                <span className="font-medium text-gray-700">#{h.tag}</span>
                <span className="text-gray-400 ml-auto">{h.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="border-t border-gray-100 pt-3 mt-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs font-medium text-gray-500">
              Suggested Hashtags
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-200 border-dashed"
              >
                #{tag}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Based on your content and industry trends
          </p>
        </div>
      )}
    </div>
  );
}
