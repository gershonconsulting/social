"use client";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2, AlertTriangle } from "lucide-react";

interface WindowStats {
  posts: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
  activeDays: number;
  daysSpan: number;
  postsPerWeek: number;
  avgEngagementPerPost: number;
  firstPostDate: string | null;
  lastPostDate: string | null;
}

interface BeforeAfterData {
  campaignStartDate: string | null;
  before: WindowStats | null;
  after: WindowStats | null;
  message?: string;
}

function delta(after: number, before: number): { pct: number | null; trend: "up" | "down" | "flat" } {
  if (before === 0 && after === 0) return { pct: 0, trend: "flat" };
  if (before === 0) return { pct: null, trend: "up" }; // infinite improvement
  const pct = Math.round(((after - before) / before) * 100);
  return { pct, trend: pct > 5 ? "up" : pct < -5 ? "down" : "flat" };
}

function DeltaBadge({ pct, trend }: { pct: number | null; trend: "up" | "down" | "flat" }) {
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const color = trend === "up" ? "text-green-700 bg-green-50" : trend === "down" ? "text-red-700 bg-red-50" : "text-gray-600 bg-gray-100";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <Icon size={11} />
      {pct === null ? "new" : `${pct >= 0 ? "+" : ""}${pct}%`}
    </span>
  );
}

function StatRow({
  label,
  before,
  after,
  formatter = (n: number) => n.toLocaleString(),
}: {
  label: string;
  before: number;
  after: number;
  formatter?: (n: number) => string;
}) {
  const d = delta(after, before);
  return (
    <div className="grid grid-cols-12 items-center gap-2 py-2 text-sm">
      <span className="col-span-4 text-gray-500">{label}</span>
      <span className="col-span-3 text-right text-gray-700 font-mono">{formatter(before)}</span>
      <span className="col-span-3 text-right text-gray-900 font-semibold font-mono">{formatter(after)}</span>
      <span className="col-span-2 text-right">
        <DeltaBadge pct={d.pct} trend={d.trend} />
      </span>
    </div>
  );
}

export function BeforeAfterPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<BeforeAfterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/clients/${clientId}/before-after`, { cache: "no-store" });
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          if (!cancelled) {
            setError(`Server returned a non-JSON response (HTTP ${r.status})`);
            setLoading(false);
          }
          return;
        }
        const j = await r.json();
        if (!cancelled) {
          if (j.success) setData(j.data);
          else setError(j.error || "Failed to load");
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Network error");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-8 flex items-center justify-center gap-2 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" />
        Loading before/after comparison…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 text-xs text-amber-800 flex items-center gap-2">
        <AlertTriangle size={14} />
        Could not load before/after comparison: {error}
      </div>
    );
  }

  if (!data?.campaignStartDate || !data.before || !data.after) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-6 py-4 text-xs text-gray-500">
        No campaign start date is set for this client. Set one in Admin to enable the before/after comparison.
      </div>
    );
  }

  const { before, after } = data;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Before us &nbsp;·&nbsp; After us</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Campaign started <span className="font-medium text-gray-700">{data.campaignStartDate}</span>
            {before.firstPostDate && <> · Earliest post on file: <span className="font-mono">{before.firstPostDate}</span></>}
          </p>
        </div>
      </div>

      <div className="px-6 py-3 border-b border-gray-100 grid grid-cols-12 gap-2 text-xs uppercase font-medium tracking-wide text-gray-400">
        <span className="col-span-4">Metric</span>
        <span className="col-span-3 text-right">
          Before
          <span className="block text-[10px] normal-case text-gray-400">
            {before.firstPostDate ?? "—"} → {data.campaignStartDate}
            <span className="ml-1">({before.daysSpan}d)</span>
          </span>
        </span>
        <span className="col-span-3 text-right">
          After
          <span className="block text-[10px] normal-case text-gray-400">
            {data.campaignStartDate} → today <span className="ml-1">({after.daysSpan}d)</span>
          </span>
        </span>
        <span className="col-span-2 text-right">Δ</span>
      </div>

      <div className="px-6 divide-y divide-gray-50">
        <StatRow label="Posts" before={before.posts} after={after.posts} />
        <StatRow label="Posts / week" before={before.postsPerWeek} after={after.postsPerWeek} formatter={(n) => n.toFixed(2)} />
        <StatRow label="Active days posting" before={before.activeDays} after={after.activeDays} />
        <StatRow label="Likes" before={before.likes} after={after.likes} />
        <StatRow label="Comments" before={before.comments} after={after.comments} />
        <StatRow label="Shares" before={before.shares} after={after.shares} />
        <StatRow label="Total engagement" before={before.engagement} after={after.engagement} />
        <StatRow label="Avg engagement / post" before={before.avgEngagementPerPost} after={after.avgEngagementPerPost} formatter={(n) => n.toFixed(1)} />
      </div>

      <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500">
        Posts are bucketed by their <span className="font-mono">publishedAtUtc</span>. Followers aren't included
        (campaign-start follower snapshots aren't backfilled — only forward-looking growth is reliable).
      </div>
    </div>
  );
}
