"use client";

import { useState, useEffect, useMemo } from "react";
import { Cloud, RefreshCw } from "lucide-react";

interface WordData {
  word: string;
  count: number;
}

interface WordCloudProps {
  clientId: string;
}

const COLORS = [
  "#dc2626", "#2563eb", "#059669", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#4f46e5", "#ea580c", "#0d9488",
];

export function WordCloud({ clientId }: WordCloudProps) {
  const [words, setWords] = useState<WordData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/word-cloud`)
      .then((r) => r.json())
      .then((data) => {
        setWords(data.words || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId]);

  const wordElements = useMemo(() => {
    if (words.length === 0) return [];
    const maxCount = Math.max(...words.map((w) => w.count));
    const minCount = Math.min(...words.map((w) => w.count));
    const range = maxCount - minCount || 1;

    return words.map((w, i) => {
      const ratio = (w.count - minCount) / range;
      const fontSize = 12 + ratio * 28; // 12px to 40px
      const opacity = 0.5 + ratio * 0.5;
      const color = COLORS[i % COLORS.length];
      const rotate = (i % 3 === 0) ? -15 + Math.random() * 30 : 0;

      return {
        ...w,
        fontSize,
        opacity,
        color,
        rotate,
      };
    });
  }, [words]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-100 rounded w-36" />
          <div className="h-48 bg-gray-50 rounded-lg" />
        </div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-2">
          <Cloud className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">Word Cloud</h3>
        </div>
        <p className="text-sm text-gray-500">
          No post content found. Sync posts to generate a word cloud.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Cloud className="w-4 h-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900">
          Word Cloud ({words.length} terms)
        </h3>
      </div>

      {/* Word cloud visualization */}
      <div className="relative bg-gray-50 rounded-lg p-6 min-h-[240px] flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {wordElements.map((w) => (
          <span
            key={w.word}
            className="inline-block cursor-default transition-transform hover:scale-110"
            style={{
              fontSize: `${w.fontSize}px`,
              color: w.color,
              opacity: w.opacity,
              transform: `rotate(${w.rotate}deg)`,
              lineHeight: 1.2,
            }}
            title={`"${w.word}" — used ${w.count} time${w.count !== 1 ? "s" : ""}`}
          >
            {w.word}
          </span>
        ))}
      </div>

      {/* Top words list */}
      <div className="border-t border-gray-100 pt-3 mt-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {words.slice(0, 8).map((w, i) => (
            <div key={w.word} className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400 w-4">{i + 1}.</span>
              <span className="font-medium text-gray-700 truncate">{w.word}</span>
              <span className="text-gray-400 ml-auto">{w.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
