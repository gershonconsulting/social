"use client";

/**
 * Content Intelligence panel.
 *
 * Two layers, deliberately separate:
 *   • Signals  — computed from the collected posts on every load. Free, instant,
 *                works with no API key.
 *   • Analysis — the Claude-generated editorial read. Cached in the DB; only
 *                regenerated when someone presses the button.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Hash,
  Lightbulb,
  Target,
  BarChart3,
  ShieldAlert,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";

// ─── Types (mirror of the API payload) ───────────────────────────────────────

type CorpusPost = {
  id: string;
  platform: string;
  date: string;
  text: string;
  hasMedia: boolean;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
  url: string | null;
};

type Stats = {
  postCount: number;
  windowDays: number;
  firstPostDate: string | null;
  lastPostDate: string | null;
  platforms: Array<{ platform: string; count: number; avgEngagement: number }>;
  byMonth: Array<{ month: string; count: number; avgEngagement: number }>;
  byWeekday: Array<{ weekday: string; count: number; avgEngagement: number }>;
  avgEngagement: number;
  medianEngagement: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  mediaRate: number;
  avgLength: number;
  hashtagRate: number;
  avgHashtagsPerPost: number;
  hashtags: Array<{ tag: string; count: number; avgEngagement: number; lastUsed: string }>;
  topPosts: CorpusPost[];
  bottomPosts: CorpusPost[];
  gapDays: number;
};

type Theme = {
  name: string;
  share: number;
  summary: string;
  performance: "high" | "average" | "low";
  examples: string[];
};

type Suggestion = {
  title: string;
  angle: string;
  why: string;
  format: string;
  hashtags: string[];
  priority: "high" | "medium" | "low";
};

type AnalysisResult = {
  headline: string;
  positioning: string;
  audience: string;
  toneOfVoice: string;
  themes: Theme[];
  contentPillars: string[];
  whatWorks: string[];
  whatFlops: string[];
  gaps: string[];
  hashtagVerdict: string;
  suggestions: Suggestion[];
  risks: string[];
};

type Analysis = {
  result: AnalysisResult;
  model: string | null;
  generatedAt: string;
  postCount: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  stale: boolean;
};

type Payload = {
  windowDays: number;
  stats: Stats;
  aiConfigured: boolean;
  analysis: Analysis | null;
};

const WINDOWS = [
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 6 months" },
  { value: 365, label: "Last year" },
  { value: 3650, label: "All time" },
];

const RED = "#FE1B04";

// ─── Small building blocks ───────────────────────────────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3 rounded-lg border border-gray-200 bg-white">
      <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{label}</div>
      <div className="text-xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Status is carried by the word, not the color — colorblind-safe by construction. */
function PerformanceBadge({ p }: { p: Theme["performance"] }) {
  const map = {
    high: { label: "Strong", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    average: { label: "Average", cls: "bg-gray-50 text-gray-600 border-gray-200" },
    low: { label: "Weak", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  }[p];
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${map.cls}`}>
      {map.label}
    </span>
  );
}

function PriorityBadge({ p }: { p: Suggestion["priority"] }) {
  const map = {
    high: { label: "Do first", cls: "bg-red-50 text-[#FE1B04] border-red-200" },
    medium: { label: "Next", cls: "bg-gray-50 text-gray-600 border-gray-200" },
    low: { label: "Later", cls: "bg-gray-50 text-gray-400 border-gray-200" },
  }[p];
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${map.cls}`}>
      {map.label}
    </span>
  );
}

/** Single-series magnitude — one hue, direct-labeled, no legend needed. */
function ShareBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: RED }} />
    </div>
  );
}

function Bullets({ items, icon: Icon, tone }: { items: string[]; icon: typeof TrendingUp; tone: string }) {
  if (!items.length) return <div className="text-xs text-gray-400">Nothing identified.</div>;
  return (
    <ul className="space-y-2">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] text-gray-700 leading-relaxed">
          <Icon size={14} className={`mt-0.5 shrink-0 ${tone}`} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

function PostRow({ p }: { p: CorpusPost }) {
  return (
    <div className="px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50">
      <div className="w-14 shrink-0 text-right">
        <div className="text-sm font-semibold text-gray-900 tabular-nums">{p.engagement}</div>
        <div className="text-[10px] text-gray-400">score</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-gray-700 line-clamp-2">{p.text || <em className="text-gray-400">No text</em>}</div>
        <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
          <span>{p.date}</span>
          <span>·</span>
          <span>{p.platform === "TWITTER" ? "X" : p.platform.replace("_", " ").toLowerCase()}</span>
          <span>·</span>
          <span>{p.likes}L / {p.comments}C / {p.shares}S</span>
          {p.hasMedia && <><span>·</span><span>media</span></>}
          {p.url && (
            <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[#FE1B04] hover:underline">
              open <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children, right }: { title: string; icon: typeof Target; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-gray-400" />
          <div className="text-sm font-semibold text-gray-900">{title}</div>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function ContentIntelligence({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [windowDays, setWindowDays] = useState(365);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [tab, setTab] = useState<"analysis" | "signals">("analysis");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/content-analysis?window=${windowDays}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [clientId, windowDays]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setRunning(true);
    setRunError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/content-analysis?window=${windowDays}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      setData((prev) => ({ ...(prev as Payload), ...j.data }));
      setTab("analysis");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  }

  const stats = data?.stats;
  const analysis = data?.analysis ?? null;
  const result = analysis?.result;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles size={18} style={{ color: RED }} />
          <div>
            <div className="text-sm font-semibold text-gray-900">Content Intelligence</div>
            <div className="text-xs text-gray-500">
              What {clientName} talks about, what earns a reaction, and what to post next.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white"
          >
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>

          <button
            onClick={generate}
            disabled={running || loading || !stats?.postCount}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: RED }}
            title={!stats?.postCount ? "No collected posts in this window" : undefined}
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : analysis ? <RefreshCw size={13} /> : <Sparkles size={13} />}
            {running ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze content"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden w-fit bg-white">
        {([["analysis", "AI analysis"], ["signals", "Signals"]] as const).map(([k, label], i) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${i === 0 ? "border-r border-gray-200" : ""} ${
              tab === k ? "bg-red-50 text-[#FE1B04]" : "text-gray-500 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
          <Loader2 size={18} className="animate-spin mr-2" /> Reading collected content…
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-red-900">Couldn&apos;t load content intelligence</div>
            <div className="text-xs text-red-700 mt-0.5">{error}</div>
            <button onClick={load} className="mt-2 text-xs font-medium text-red-700 underline">Try again</button>
          </div>
        </div>
      )}

      {runError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
          <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">{runError}</div>
        </div>
      )}

      {!loading && !error && stats && (
        <>
          {/* Coverage strip — always visible */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatTile
              label="Posts analysed"
              value={String(stats.postCount)}
              sub={stats.firstPostDate ? `${stats.firstPostDate} → ${stats.lastPostDate}` : "nothing collected"}
            />
            <StatTile label="Avg engagement" value={String(stats.avgEngagement)} sub={`median ${stats.medianEngagement}`} />
            <StatTile label="With media" value={`${stats.mediaRate}%`} sub={`avg ${stats.avgLength} chars`} />
            <StatTile label="With hashtags" value={`${stats.hashtagRate}%`} sub={`${stats.avgHashtagsPerPost} per post`} />
            <StatTile label="Longest silence" value={`${stats.gapDays}d`} sub="between two posts" />
          </div>

          {stats.postCount === 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
              <div className="text-sm font-semibold text-gray-700">No content collected in this window</div>
              <div className="text-xs text-gray-500 mt-1">
                Widen the window, or run a sync to collect posts for {clientName}.
              </div>
            </div>
          )}

          {/* ── AI ANALYSIS TAB ── */}
          {tab === "analysis" && stats.postCount > 0 && (
            <>
              {!data.aiConfigured && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
                  <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-amber-900">AI analysis is not configured</div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      Add an Anthropic API key in <a href="/settings" className="underline font-medium">Settings → Content Intelligence (AI)</a>.
                      The Signals tab works without it.
                    </div>
                  </div>
                </div>
              )}

              {!analysis && data.aiConfigured && (
                <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
                  <Sparkles size={22} className="mx-auto mb-2" style={{ color: RED }} />
                  <div className="text-sm font-semibold text-gray-800">No analysis yet</div>
                  <div className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                    Press <strong>Analyze content</strong> to read all {stats.postCount} collected posts and produce
                    themes, an audience read, what works, what flops, and topic suggestions.
                  </div>
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  {analysis?.stale && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-xs text-blue-800">
                      New posts have been collected since this analysis ({analysis.postCount} → {stats.postCount}). Re-analyze to refresh it.
                    </div>
                  )}

                  {/* Headline */}
                  <div className="bg-white rounded-xl border-l-4 border border-gray-200 p-5" style={{ borderLeftColor: RED }}>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">The read</div>
                    <div className="text-base font-semibold text-gray-900 leading-snug">{result.headline}</div>
                    <div className="grid md:grid-cols-3 gap-4 mt-4">
                      {([["Positioning", result.positioning], ["Audience", result.audience], ["Tone of voice", result.toneOfVoice]] as const).map(([k, v]) => (
                        <div key={k}>
                          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{k}</div>
                          <div className="text-[13px] text-gray-700 mt-1 leading-relaxed">{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Themes */}
                  {result.themes.length > 0 && (
                    <Section title="What they actually talk about" icon={Target}>
                      <div className="space-y-4">
                        {result.themes.map((t, i) => {
                          const max = Math.max(...result.themes.map((x) => x.share), 1);
                          return (
                            <div key={i}>
                              <div className="flex items-center justify-between gap-3 mb-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[13px] font-semibold text-gray-900 truncate">{t.name}</span>
                                  <PerformanceBadge p={t.performance} />
                                </div>
                                <span className="text-xs text-gray-500 tabular-nums shrink-0">{t.share}% of posts</span>
                              </div>
                              <ShareBar value={t.share} max={max} />
                              <div className="text-[13px] text-gray-600 mt-1.5 leading-relaxed">{t.summary}</div>
                              {t.examples.length > 0 && (
                                <ul className="mt-1.5 space-y-1">
                                  {t.examples.map((ex, j) => (
                                    <li key={j} className="text-[12px] text-gray-500 italic border-l-2 border-gray-200 pl-2">{ex}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {result.contentPillars.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-gray-100">
                          <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Pillars to own</div>
                          <div className="flex flex-wrap gap-1.5">
                            {result.contentPillars.map((p, i) => (
                              <span key={i} className="text-xs font-medium px-2 py-1 rounded-lg bg-red-50 text-[#FE1B04] border border-red-100">{p}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </Section>
                  )}

                  {/* Works / flops */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <Section title="What earns a reaction" icon={TrendingUp}>
                      <Bullets items={result.whatWorks} icon={TrendingUp} tone="text-emerald-600" />
                    </Section>
                    <Section title="What falls flat" icon={TrendingDown}>
                      <Bullets items={result.whatFlops} icon={TrendingDown} tone="text-amber-600" />
                    </Section>
                  </div>

                  {/* Gaps + hashtags */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <Section title="Missing subjects" icon={Target}>
                      <Bullets items={result.gaps} icon={CheckCircle2} tone="text-gray-400" />
                    </Section>
                    <Section title="Hashtag verdict" icon={Hash}>
                      <div className="text-[13px] text-gray-700 leading-relaxed">{result.hashtagVerdict || "No verdict."}</div>
                    </Section>
                  </div>

                  {/* Suggestions */}
                  {result.suggestions.length > 0 && (
                    <Section title="Post these next" icon={Lightbulb}>
                      <div className="grid md:grid-cols-2 gap-3">
                        {result.suggestions.map((s, i) => (
                          <div key={i} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-[13px] font-semibold text-gray-900 leading-snug">{s.title}</div>
                              <PriorityBadge p={s.priority} />
                            </div>
                            <div className="text-[13px] text-gray-600 mt-1.5 leading-relaxed">{s.angle}</div>
                            {s.why && <div className="text-[12px] text-gray-500 mt-1.5"><span className="font-medium text-gray-600">Why: </span>{s.why}</div>}
                            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                              {s.format && <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{s.format}</span>}
                              {s.hashtags.map((h, j) => (
                                <span key={j} className="text-[11px] text-gray-500">#{h}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  {result.risks.length > 0 && (
                    <Section title="Watch out" icon={ShieldAlert}>
                      <Bullets items={result.risks} icon={ShieldAlert} tone="text-amber-600" />
                    </Section>
                  )}

                  <div className="text-[11px] text-gray-400 px-1">
                    Generated {new Date(analysis!.generatedAt).toLocaleString()} · {analysis!.model} ·{" "}
                    {analysis!.postCount} posts · {(analysis!.durationMs / 1000).toFixed(1)}s ·{" "}
                    {analysis!.inputTokens.toLocaleString()} in / {analysis!.outputTokens.toLocaleString()} out tokens
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── SIGNALS TAB ── */}
          {tab === "signals" && stats.postCount > 0 && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Section title="Cadence by month" icon={BarChart3}>
                  {stats.byMonth.length === 0 ? (
                    <div className="text-xs text-gray-400">No data.</div>
                  ) : (
                    <div className="space-y-2">
                      {stats.byMonth.map((m) => {
                        const max = Math.max(...stats.byMonth.map((x) => x.count), 1);
                        return (
                          <div key={m.month} className="flex items-center gap-3">
                            <div className="w-16 shrink-0 text-[11px] text-gray-500 tabular-nums">{m.month}</div>
                            <div className="flex-1"><ShareBar value={m.count} max={max} /></div>
                            <div className="w-24 shrink-0 text-right text-[11px] text-gray-500 tabular-nums">
                              {m.count} · avg {m.avgEngagement}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Section>

                <Section title="Engagement by weekday" icon={BarChart3}>
                  {stats.byWeekday.length === 0 ? (
                    <div className="text-xs text-gray-400">No data.</div>
                  ) : (
                    <div className="space-y-2">
                      {stats.byWeekday.map((d) => {
                        const max = Math.max(...stats.byWeekday.map((x) => x.avgEngagement), 1);
                        return (
                          <div key={d.weekday} className="flex items-center gap-3">
                            <div className="w-20 shrink-0 text-[11px] text-gray-500">{d.weekday}</div>
                            <div className="flex-1"><ShareBar value={d.avgEngagement} max={max} /></div>
                            <div className="w-24 shrink-0 text-right text-[11px] text-gray-500 tabular-nums">
                              avg {d.avgEngagement} · {d.count}p
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Section>
              </div>

              <Section title="Hashtags — usage vs. payoff" icon={Hash}>
                {stats.hashtags.length === 0 ? (
                  <div className="text-xs text-gray-400">No hashtags found in the collected posts.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100">
                          <th className="py-1.5 pr-3 font-semibold">Hashtag</th>
                          <th className="py-1.5 pr-3 font-semibold text-right">Uses</th>
                          <th className="py-1.5 pr-3 font-semibold text-right">Avg engagement</th>
                          <th className="py-1.5 font-semibold text-right">Last used</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {stats.hashtags.slice(0, 25).map((h) => (
                          <tr key={h.tag} className="hover:bg-gray-50">
                            <td className="py-1.5 pr-3 text-gray-800">#{h.tag}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">{h.count}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums text-gray-600">
                              {h.avgEngagement}
                              {h.avgEngagement > stats.avgEngagement && (
                                <span className="ml-1 text-[10px] font-semibold text-emerald-600">above avg</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-gray-400">{h.lastUsed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                    <TrendingUp size={15} className="text-emerald-600" />
                    <div className="text-sm font-semibold text-gray-900">Best performing posts</div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {stats.topPosts.map((p) => <PostRow key={p.id} p={p} />)}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                    <TrendingDown size={15} className="text-amber-600" />
                    <div className="text-sm font-semibold text-gray-900">Weakest performing posts</div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {stats.bottomPosts.map((p) => <PostRow key={p.id} p={p} />)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
