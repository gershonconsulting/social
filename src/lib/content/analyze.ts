/**
 * Content Intelligence — AI analysis engine.
 *
 * The prompt lives here; which vendor answers it lives in ./provider.ts. That
 * split is why adding OpenAI (v3.6.0) touched no prompt text.
 */

import type { Corpus, CorpusPost, ContentStats } from "./corpus";
import {
  getAISettings,
  runChat,
  listModels,
  defaultModelFor,
  DEFAULT_ANTHROPIC_MODEL,
  type AISettings,
  type AIProvider,
} from "./provider";

/** @deprecated kept as a re-export so older call sites keep compiling. */
export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;

export type AnthropicSettings = AISettings;

/** @deprecated use getAISettings(); this is the same call under the old name. */
export const getAnthropicSettings = getAISettings;

export { getAISettings, listModels, defaultModelFor };
export type { AISettings, AIProvider };

// ─── Result shape ────────────────────────────────────────────────────────────

export type Theme = {
  name: string;
  share: number; // % of posts, 0-100
  summary: string;
  performance: "high" | "average" | "low";
  examples: string[];
};

export type Suggestion = {
  title: string;
  angle: string;
  why: string;
  format: string;
  hashtags: string[];
  priority: "high" | "medium" | "low";
};

export type AnalysisResult = {
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

// ─── Prompt ──────────────────────────────────────────────────────────────────

function trimPost(p: CorpusPost, max = 420): string {
  const t = p.text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function buildPrompt(
  client: { name: string; industry: string | null; website: string | null; clientType: string },
  corpus: Corpus
): string {
  const s = corpus.stats;

  const sample = corpus.posts.slice(0, 120);

  const lines: string[] = [];
  lines.push(`# Company`);
  lines.push(`Name: ${client.name}`);
  if (client.industry) lines.push(`Industry: ${client.industry}`);
  if (client.website) lines.push(`Website: ${client.website}`);
  lines.push(`Record type in our CRM: ${client.clientType}`);
  lines.push("");

  lines.push(`# Collected content statistics (last ${s.windowDays} days)`);
  lines.push(`Posts analysed: ${s.postCount} (${s.firstPostDate} → ${s.lastPostDate})`);
  lines.push(`Platforms: ${s.platforms.map((p) => `${p.platform} ${p.count} posts, avg engagement ${p.avgEngagement}`).join(" | ") || "none"}`);
  lines.push(`Average engagement score: ${s.avgEngagement} (median ${s.medianEngagement}). Score = likes + 3×comments + 5×shares.`);
  lines.push(`Totals: ${s.totalLikes} likes, ${s.totalComments} comments, ${s.totalShares} shares.`);
  lines.push(`Media attached on ${s.mediaRate}% of posts. Average post length ${s.avgLength} characters.`);
  lines.push(`Hashtags used on ${s.hashtagRate}% of posts, ${s.avgHashtagsPerPost} per post on average.`);
  lines.push(`Longest silence between posts: ${s.gapDays} days.`);
  lines.push("");

  if (s.byMonth.length) {
    lines.push(`## Cadence by month (month · posts · avg engagement)`);
    lines.push(s.byMonth.map((m) => `${m.month} · ${m.count} · ${m.avgEngagement}`).join("\n"));
    lines.push("");
  }

  if (s.byWeekday.length) {
    lines.push(`## By weekday (day · posts · avg engagement)`);
    lines.push(s.byWeekday.map((d) => `${d.weekday} · ${d.count} · ${d.avgEngagement}`).join("\n"));
    lines.push("");
  }

  if (s.hashtags.length) {
    lines.push(`## Hashtags (tag · uses · avg engagement · last used)`);
    lines.push(s.hashtags.slice(0, 30).map((h) => `#${h.tag} · ${h.count} · ${h.avgEngagement} · ${h.lastUsed}`).join("\n"));
    lines.push("");
  }

  if (s.topPosts.length) {
    lines.push(`## Highest-engagement posts`);
    for (const p of s.topPosts) {
      lines.push(`[${p.date} · ${p.platform} · score ${p.engagement} · ${p.likes}L/${p.comments}C/${p.shares}S · media:${p.hasMedia}] ${trimPost(p)}`);
    }
    lines.push("");
  }

  if (s.bottomPosts.length) {
    lines.push(`## Lowest-engagement posts`);
    for (const p of s.bottomPosts) {
      lines.push(`[${p.date} · ${p.platform} · score ${p.engagement} · media:${p.hasMedia}] ${trimPost(p)}`);
    }
    lines.push("");
  }

  lines.push(`## Post corpus (most recent ${sample.length})`);
  for (const p of sample) {
    lines.push(`[${p.date} · ${p.platform} · score ${p.engagement}] ${trimPost(p, 320)}`);
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a senior B2B social content strategist working inside Gershon Consulting's social CRM. You are handed every social post the platform has collected for one company, plus pre-computed engagement statistics.

Your job is to turn that raw content into an editorial read of the account: what this company actually talks about, who it is talking to, what earns a reaction, what falls flat, and what it should post next.

Rules:
- Be concrete and specific to THIS company. Never produce advice that could apply to any business ("post consistently", "engage your audience"). If you cannot be specific, say so plainly.
- Ground every claim in the supplied data. Quote or paraphrase real posts. Cite real numbers.
- The engagement score is likes + 3×comments + 5×shares. Small absolute numbers are normal in B2B — compare posts against this account's own median, never against an imagined benchmark.
- Topic suggestions must be things this company has NOT already covered, must be plausible for its industry and evidence base, and must be shaped to draw a reaction from the audience you identified.
- Write in US English. No emoji. No filler.
- If the corpus is thin (under ~15 posts), still answer, but say clearly in "headline" that the sample is small and treat conclusions as provisional.

Return ONLY a JSON object, no markdown fence, no prose before or after, matching exactly this shape:

{
  "headline": "one sentence, the single most important read on this account",
  "positioning": "2-3 sentences: how this company positions itself through its content",
  "audience": "2-3 sentences: who the content is actually addressed to, inferred from language, references and what gets engagement",
  "toneOfVoice": "2-3 sentences describing the voice, with a distinguishing detail",
  "themes": [{"name":"...","share":25,"summary":"...","performance":"high|average|low","examples":["short quote or paraphrase of a real post"]}],
  "contentPillars": ["3 to 5 short labels for the pillars this account should own"],
  "whatWorks": ["3 to 5 evidence-backed patterns that earn engagement here, each citing a real post or number"],
  "whatFlops": ["3 to 5 evidence-backed patterns that underperform here, each citing a real post or number"],
  "gaps": ["3 to 5 subjects an audience like this expects that the account never covers"],
  "hashtagVerdict": "2-3 sentences on hashtag usage: which to keep, which to drop, which to add, referencing the real tags and their numbers",
  "suggestions": [{"title":"...","angle":"...","why":"...","format":"e.g. carousel, founder video, customer proof post","hashtags":["tag"],"priority":"high|medium|low"}],
  "risks": ["0 to 3 things that could hurt this account: repetition, dead cadence, off-message posts, stale claims"]
}

Provide 4-6 themes and 6-8 suggestions. "share" values across themes should roughly total 100.`;

// ─── Runner ──────────────────────────────────────────────────────────────────

export type AnalyzeOutcome = {
  result: AnalysisResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // The model occasionally wraps the object in a sentence. Grab the outermost
    // balanced braces and try again.
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Model did not return parseable JSON.");
  }
}

function asStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max);
}

/** Normalize whatever the model returned into the shape the UI expects. */
function coerce(raw: unknown): AnalysisResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");

  const themes: Theme[] = Array.isArray(o.themes)
    ? (o.themes as Record<string, unknown>[]).slice(0, 8).map((t) => ({
        name: typeof t.name === "string" ? t.name : "Untitled theme",
        share: typeof t.share === "number" ? Math.max(0, Math.min(100, Math.round(t.share))) : 0,
        summary: typeof t.summary === "string" ? t.summary : "",
        performance:
          t.performance === "high" || t.performance === "low" ? t.performance : "average",
        examples: asStringArray(t.examples, 3),
      }))
    : [];

  const suggestions: Suggestion[] = Array.isArray(o.suggestions)
    ? (o.suggestions as Record<string, unknown>[]).slice(0, 10).map((s) => ({
        title: typeof s.title === "string" ? s.title : "Untitled",
        angle: typeof s.angle === "string" ? s.angle : "",
        why: typeof s.why === "string" ? s.why : "",
        format: typeof s.format === "string" ? s.format : "",
        hashtags: asStringArray(s.hashtags, 6).map((h) => h.replace(/^#/, "")),
        priority: s.priority === "high" || s.priority === "low" ? s.priority : "medium",
      }))
    : [];

  return {
    headline: str("headline"),
    positioning: str("positioning"),
    audience: str("audience"),
    toneOfVoice: str("toneOfVoice"),
    themes,
    contentPillars: asStringArray(o.contentPillars, 6),
    whatWorks: asStringArray(o.whatWorks, 6),
    whatFlops: asStringArray(o.whatFlops, 6),
    gaps: asStringArray(o.gaps, 6),
    hashtagVerdict: str("hashtagVerdict"),
    suggestions,
    risks: asStringArray(o.risks, 4),
  };
}

export async function runAnalysis(
  client: { name: string; industry: string | null; website: string | null; clientType: string },
  corpus: Corpus,
  settings: AISettings
): Promise<AnalyzeOutcome> {
  const started = Date.now();
  const prompt = buildPrompt(client, corpus);

  const chat = await runChat(settings, SYSTEM_PROMPT, prompt, 6000);

  return {
    result: coerce(extractJson(chat.text)),
    model: chat.model,
    inputTokens: chat.inputTokens,
    outputTokens: chat.outputTokens,
    durationMs: Date.now() - started,
  };
}

export type { Corpus, ContentStats };
