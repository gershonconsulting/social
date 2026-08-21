"use client";

/**
 * Post Studio panel — CAMPAIGN companies only.
 *
 * Content Intelligence tells you what the account has been doing. This tab hands
 * you the thing you actually paste into a writer: a ready-to-use prompt built
 * from the account's own posts, plus a hashtag set split into Core / Rotating /
 * Drop with the numbers behind each call.
 */

import { useCallback, useEffect, useState } from "react";
import {
  PenLine,
  Loader2,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
  Hash,
  CalendarClock,
  Megaphone,
  ListChecks,
  Ban,
  Sparkles,
} from "lucide-react";

// ─── Types (mirror of the API payload) ───────────────────────────────────────

type HashtagPick = {
  tag: string;
  reason: string;
  uses: number;
  avgEngagement: number | null;
};

type PostStarter = {
  title: string;
  hook: string;
  format: string;
  hashtags: string[];
};

type BriefResult = {
  headline: string;
  promptText: string;
  audience: string;
  voice: string;
  structure: string[];
  doList: string[];
  dontList: string[];
  cadence: string;
  hashtags: {
    core: HashtagPick[];
    rotating: HashtagPick[];
    drop: HashtagPick[];
    recipe: string;
  };
  starters: PostStarter[];
  notes: string[];
};

type Brief = {
  result: BriefResult;
  model: string | null;
  generatedAt: string;
  postCount: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  stale: boolean;
};

type Coverage = {
  postCount: number;
  firstPostDate: string | null;
  lastPostDate: string | null;
  avgEngagement: number;
  medianEngagement: number;
  hashtagRate: number;
  distinctHashtags: number;
};

type Payload = {
  windowDays: number;
  aiConfigured: boolean;
  coverage: Coverage;
  brief: Brief | null;
};

const WINDOWS = [
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 6 months" },
  { value: 365, label: "Last year" },
  { value: 3650, label: "All time" },
];

const RED = "#FE1B04";

// ─── Building blocks ─────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  children,
  right,
  sub,
}: {
  title: string;
  icon: typeof Hash;
  children: React.ReactNode;
  right?: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={15} className="text-gray-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900">{title}</div>
            {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
          </div>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * Copy button with a confirmed state. Falls back to a hidden textarea because
 * navigator.clipboard is unavailable on non-HTTPS origins and in some embedded
 * browsers — the copy must not silently do nothing.
 */
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      setDone(false);
    }
  }

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors"
      style={
        done
          ? { borderColor: "#a7f3d0", backgroundColor: "#ecfdf5", color: "#047857" }
          : { borderColor: "#e5e7eb", backgroundColor: "#fff", color: "#374151" }
      }
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}

function TagPill({ pick, tone }: { pick: HashtagPick; tone: "core" | "rotating" | "drop" }) {
  const style = {
    core: "bg-red-50 text-[#FE1B04] border-red-200",
    rotating: "bg-gray-50 text-gray-700 border-gray-200",
    drop: "bg-gray-50 text-gray-400 border-gray-200 line-through",
  }[tone];

  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className={`text-xs font-semibold px-2 py-1 rounded-lg border shrink-0 ${style}`}>
        #{pick.tag}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-gray-700 leading-relaxed">{pick.reason}</div>
        <div className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
          {pick.uses > 0 ? (
            <>
              used {pick.uses}× · avg engagement {pick.avgEngagement}
            </>
          ) : (
            <>not used yet — new suggestion</>
          )}
        </div>
      </div>
    </div>
  );
}

function Bullets({ items, icon: Icon, tone }: { items: string[]; icon: typeof ListChecks; tone: string }) {
  if (!items.length) return <div className="text-xs text-gray-400">Nothing listed.</div>;
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

// ─── Main ────────────────────────────────────────────────────────────────────

export function PostStudio({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [windowDays, setWindowDays] = useState(365);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/post-prompt?window=${windowDays}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [clientId, windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setRunning(true);
    setRunError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/post-prompt?window=${windowDays}`, {
        method: "POST",
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      setData((prev) => ({ ...(prev as Payload), ...j.data }));
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setRunning(false);
    }
  }

  const coverage = data?.coverage;
  const brief = data?.brief ?? null;
  const r = brief?.result;

  const hashtagBlock = r
    ? [
        r.hashtags.core.length ? `Core (every post): ${r.hashtags.core.map((h) => "#" + h.tag).join(" ")}` : "",
        r.hashtags.rotating.length
          ? `Rotating (pick by topic): ${r.hashtags.rotating.map((h) => "#" + h.tag).join(" ")}`
          : "",
        r.hashtags.drop.length ? `Stop using: ${r.hashtags.drop.map((h) => "#" + h.tag).join(" ")}` : "",
        r.hashtags.recipe,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <PenLine size={18} style={{ color: RED }} />
          <div>
            <div className="text-sm font-semibold text-gray-900">Post Studio</div>
            <div className="text-xs text-gray-500">
              A ready-to-use prompt and hashtag set for {clientName}&apos;s next posts, built from what we
              collected.
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
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>

          <button
            onClick={generate}
            disabled={running || loading || !coverage?.postCount}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: RED }}
            title={!coverage?.postCount ? "No collected posts in this window" : undefined}
          >
            {running ? (
              <Loader2 size={13} className="animate-spin" />
            ) : brief ? (
              <RefreshCw size={13} />
            ) : (
              <Sparkles size={13} />
            )}
            {running ? "Writing the brief…" : brief ? "Regenerate" : "Generate prompt"}
          </button>
        </div>
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
            <div className="text-sm font-semibold text-red-900">Couldn&apos;t load Post Studio</div>
            <div className="text-xs text-red-700 mt-0.5">{error}</div>
            <button onClick={load} className="mt-2 text-xs font-medium text-red-700 underline">
              Try again
            </button>
          </div>
        </div>
      )}

      {runError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
          <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-800">{runError}</div>
        </div>
      )}

      {!loading && !error && coverage && (
        <>
          {/* Coverage strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: "Posts behind this brief",
                value: String(coverage.postCount),
                sub: coverage.firstPostDate
                  ? `${coverage.firstPostDate} → ${coverage.lastPostDate}`
                  : "nothing collected",
              },
              {
                label: "Engagement bar",
                value: String(coverage.medianEngagement),
                sub: `median · avg ${coverage.avgEngagement}`,
              },
              {
                label: "Posts with hashtags",
                value: `${coverage.hashtagRate}%`,
                sub: `${coverage.distinctHashtags} distinct tags seen`,
              },
              {
                label: "Brief status",
                value: brief ? (brief.stale ? "Outdated" : "Current") : "None yet",
                sub: brief ? `from ${brief.postCount} posts` : "press Generate prompt",
              },
            ].map((t) => (
              <div key={t.label} className="px-4 py-3 rounded-lg border border-gray-200 bg-white">
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">{t.label}</div>
                <div className="text-xl font-semibold text-gray-900 mt-1 tabular-nums">{t.value}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{t.sub}</div>
              </div>
            ))}
          </div>

          {coverage.postCount === 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
              <div className="text-sm font-semibold text-gray-700">No content collected in this window</div>
              <div className="text-xs text-gray-500 mt-1">
                Widen the window, or run a sync to collect posts for {clientName}.
              </div>
            </div>
          )}

          {!data.aiConfigured && coverage.postCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-2">
              <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-amber-900">AI is not configured</div>
                <div className="text-xs text-amber-800 mt-0.5">
                  Add an Anthropic API key in{" "}
                  <a href="/settings" className="underline font-medium">
                    Settings → Content Intelligence (AI)
                  </a>
                  . Post Studio uses the same key.
                </div>
              </div>
            </div>
          )}

          {!brief && data.aiConfigured && coverage.postCount > 0 && (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
              <PenLine size={22} className="mx-auto mb-2" style={{ color: RED }} />
              <div className="text-sm font-semibold text-gray-800">No prompt generated yet</div>
              <div className="text-xs text-gray-500 mt-1 max-w-lg mx-auto">
                Press <strong>Generate prompt</strong> to turn {coverage.postCount} collected posts into a
                paste-ready writing prompt and a hashtag set for {clientName}. If Content Intelligence has
                already analyzed this window, the brief reuses that read instead of starting over.
              </div>
            </div>
          )}

          {r && (
            <div className="space-y-4">
              {brief?.stale && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-xs text-blue-800">
                  New posts have been collected since this brief ({brief.postCount} → {coverage.postCount}).
                  Regenerate to refresh it.
                </div>
              )}

              {/* Headline */}
              <div
                className="bg-white rounded-xl border-l-4 border border-gray-200 p-5"
                style={{ borderLeftColor: RED }}
              >
                <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                  The instruction
                </div>
                <div className="text-base font-semibold text-gray-900 leading-snug">{r.headline}</div>
                <div className="grid md:grid-cols-2 gap-4 mt-4">
                  {(
                    [
                      ["Writing for", r.audience],
                      ["Voice to match", r.voice],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{k}</div>
                      <div className="text-[13px] text-gray-700 mt-1 leading-relaxed">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* The prompt — the product */}
              <Section
                title="Ready-to-use prompt"
                icon={Megaphone}
                sub="Paste into any AI writer, add your topic on the last line."
                right={<CopyButton text={r.promptText} label="Copy prompt" />}
              >
                <pre className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-[28rem] overflow-y-auto font-sans">
                  {r.promptText}
                </pre>
              </Section>

              {/* Hashtags */}
              <Section
                title="Hashtag set"
                icon={Hash}
                sub="Numbers are this account's own usage and average engagement."
                right={hashtagBlock ? <CopyButton text={hashtagBlock} label="Copy tags" /> : undefined}
              >
                <div className="space-y-5">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                      Core — every post
                    </div>
                    {r.hashtags.core.length ? (
                      <div className="divide-y divide-gray-50">
                        {r.hashtags.core.map((h) => (
                          <TagPill key={h.tag} pick={h} tone="core" />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">No core set proposed.</div>
                    )}
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                      Rotating — pick by topic
                    </div>
                    {r.hashtags.rotating.length ? (
                      <div className="divide-y divide-gray-50">
                        {r.hashtags.rotating.map((h) => (
                          <TagPill key={h.tag} pick={h} tone="rotating" />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">No rotating set proposed.</div>
                    )}
                  </div>

                  {r.hashtags.drop.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                        Drop — used a lot, no payoff
                      </div>
                      <div className="divide-y divide-gray-50">
                        {r.hashtags.drop.map((h) => (
                          <TagPill key={h.tag} pick={h} tone="drop" />
                        ))}
                      </div>
                    </div>
                  )}

                  {r.hashtags.recipe && (
                    <div className="pt-3 border-t border-gray-100 text-[13px] text-gray-700 leading-relaxed">
                      {r.hashtags.recipe}
                    </div>
                  )}
                </div>
              </Section>

              {/* Rules */}
              <div className="grid md:grid-cols-2 gap-4">
                <Section title="Always do" icon={ListChecks}>
                  <Bullets items={r.doList} icon={ListChecks} tone="text-emerald-600" />
                </Section>
                <Section title="Never do" icon={Ban}>
                  <Bullets items={r.dontList} icon={Ban} tone="text-amber-600" />
                </Section>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <Section title="Post structure" icon={ListChecks}>
                  <Bullets items={r.structure} icon={ListChecks} tone="text-gray-400" />
                </Section>
                <Section title="Cadence" icon={CalendarClock}>
                  <div className="text-[13px] text-gray-700 leading-relaxed">
                    {r.cadence || "No cadence recommendation."}
                  </div>
                </Section>
              </div>

              {/* Starters */}
              {r.starters.length > 0 && (
                <Section title="Three you could post this week" icon={Sparkles}>
                  <div className="grid md:grid-cols-3 gap-3">
                    {r.starters.map((s, i) => (
                      <div key={i} className="border border-gray-200 rounded-lg p-4 flex flex-col">
                        <div className="text-[13px] font-semibold text-gray-900 leading-snug">{s.title}</div>
                        {s.hook && (
                          <div className="text-[13px] text-gray-600 mt-2 leading-relaxed italic border-l-2 border-gray-200 pl-2">
                            {s.hook}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          {s.format && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              {s.format}
                            </span>
                          )}
                          {s.hashtags.map((h, j) => (
                            <span key={j} className="text-[11px] text-gray-500">
                              #{h}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {r.notes.length > 0 && (
                <Section title="Caveats" icon={AlertCircle}>
                  <Bullets items={r.notes} icon={AlertCircle} tone="text-gray-400" />
                </Section>
              )}

              <div className="text-[11px] text-gray-400 px-1">
                Generated {new Date(brief!.generatedAt).toLocaleString()} · {brief!.model} · {brief!.postCount}{" "}
                posts · {(brief!.durationMs / 1000).toFixed(1)}s · {brief!.inputTokens.toLocaleString()} in /{" "}
                {brief!.outputTokens.toLocaleString()} out tokens
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
