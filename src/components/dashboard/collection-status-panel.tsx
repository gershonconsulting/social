"use client";

import { useState } from "react";
import { CheckCircle2, Inbox, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";

/**
 * CollectionStatusPanel — top-of-dashboard summary of the last scrape run.
 *
 * Answers, at a glance:
 *   - When did we last collect? (max lastSyncAt across configured platforms)
 *   - How many platforms collected content?
 *   - For the ones that didn't: WHY — split into three distinct reasons that
 *     would otherwise all read as "no content":
 *       - Reached — no content : page loaded fine, genuinely nothing to collect
 *       - Failed  — couldn't access : the scrape errored (timeout / blocked / DB)
 *       - Stale   — not run recently : hasn't been scraped inside the window
 *
 * NOTE (honest caveat): the scraper currently marks a silent selector-timeout
 * as a successful empty run, so a quietly blocked page can still show up under
 * "Reached — no content". Separating those fully needs the scraper to report a
 * reason code — tracked as a follow-up. Hard errors DO land under "Failed".
 */

export type CollectionState = "collected" | "empty" | "failed" | "stale";

export interface ConnStatus {
  clientId: string;
  clientName: string;
  platform: string;
  state: CollectionState;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface CollectionStatus {
  lastUpdate: string | null;
  totalConfigured: number;
  counts: { collected: number; empty: number; failed: number; stale: number };
  connections: ConnStatus[];
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
};

const STATE_META: Record<
  CollectionState,
  { label: string; chip: string; dot: string; badge: string; Icon: typeof CheckCircle2 }
> = {
  collected: {
    label: "Collected — content found",
    chip: "bg-green-50 border-green-200 text-green-700",
    dot: "bg-green-500",
    badge: "bg-green-100 text-green-700",
    Icon: CheckCircle2,
  },
  empty: {
    label: "Reached — no content",
    chip: "bg-amber-50 border-amber-200 text-amber-700",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-700",
    Icon: Inbox,
  },
  failed: {
    label: "Failed — couldn't access",
    chip: "bg-red-50 border-red-200 text-red-700",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-700",
    Icon: XCircle,
  },
  stale: {
    label: "Stale — not run recently",
    chip: "bg-gray-50 border-gray-200 text-gray-600",
    dot: "bg-gray-400",
    badge: "bg-gray-100 text-gray-600",
    Icon: Clock,
  },
};

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function absoluteTime(iso: string | null): string {
  if (!iso) return "no successful run on record";
  try {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function CollectionStatusPanel({ data }: { data: CollectionStatus }) {
  const [showDetails, setShowDetails] = useState(false);
  const { counts, totalConfigured, lastUpdate, connections } = data;

  const needsAttention = connections.filter((c) => c.state !== "collected");
  const order: CollectionState[] = ["collected", "empty", "failed", "stale"];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Content Collection</h2>
          <span className="text-xs text-gray-400">{totalConfigured} platforms configured</span>
        </div>
        <div className="text-xs text-gray-500" title={absoluteTime(lastUpdate)}>
          Last update: <span className="font-semibold text-gray-700">{relativeTime(lastUpdate)}</span>
        </div>
      </div>

      <div className="p-5">
        {/* Headline */}
        <div className="mb-4">
          <div className="text-2xl font-bold text-gray-900">
            {counts.collected}
            <span className="text-gray-400 font-semibold"> / {totalConfigured}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            platforms collected content on the most recent run
          </div>
        </div>

        {/* State chips */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {order.map((state) => {
            const meta = STATE_META[state];
            const { Icon } = meta;
            return (
              <div key={state} className={`rounded-lg border px-3 py-2.5 ${meta.chip}`}>
                <div className="flex items-center gap-1.5">
                  <Icon className="w-4 h-4" />
                  <span className="text-2xl font-bold leading-none">{counts[state]}</span>
                </div>
                <div className="text-[11px] font-medium mt-1.5 leading-tight">{meta.label}</div>
              </div>
            );
          })}
        </div>

        {/* Attention list toggle */}
        {needsAttention.length > 0 ? (
          <button
            onClick={() => setShowDetails((s) => !s)}
            className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
          >
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {showDetails ? "Hide" : "Show"} {needsAttention.length} platform
            {needsAttention.length === 1 ? "" : "s"} without fresh content
          </button>
        ) : (
          <div className="mt-4 text-xs text-green-700 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> All configured platforms collected content.
          </div>
        )}

        {showDetails && needsAttention.length > 0 && (
          <div className="mt-3 border border-gray-100 rounded-lg divide-y divide-gray-100">
            {needsAttention.map((c) => {
              const meta = STATE_META[c.state];
              return (
                <div key={`${c.clientId}-${c.platform}`} className="px-3 py-2.5 flex items-start gap-3">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{c.clientName}</span>
                      <span className="text-xs text-gray-400">
                        {PLATFORM_LABELS[c.platform] ?? c.platform}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </div>
                    {c.state === "failed" && c.lastSyncError && (
                      <div className="text-xs text-red-700 mt-1 break-words">{c.lastSyncError.slice(0, 200)}</div>
                    )}
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      last attempt {relativeTime(c.lastSyncAt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Honest caveat */}
        <div className="mt-4 text-[11px] text-gray-400 leading-snug">
          &ldquo;Reached — no content&rdquo; means the page loaded but had nothing in the lookback window.
          &ldquo;Failed&rdquo; means the scrape errored before it could read the page. A silently blocked
          page can still appear as &ldquo;no content&rdquo; until the scraper reports a reason code.
        </div>
      </div>
    </div>
  );
}
