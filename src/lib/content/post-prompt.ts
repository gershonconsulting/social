/**
 * Post Studio — writing-brief generator.
 *
 * Content Intelligence answers "what is this account doing?". Post Studio
 * answers "what do I paste into an AI writer to get the next post right?".
 * It turns the collected corpus into two artifacts:
 *
 *   1. `promptText` — a complete, paste-ready prompt describing voice, audience,
 *      structure, rules and hashtags for THIS company. Copy it into Claude,
 *      ChatGPT, CloudCampaign, wherever the post actually gets written.
 *   2. A hashtag strategy split into Core / Rotating / Drop, each line backed by
 *      the account's own usage-vs-payoff numbers.
 *
 * CAMPAIGN companies only — that gate lives in the route, not here, so the
 * engine stays testable on any client id.
 *
 * Same edge-safe shape as analyze.ts: plain fetch, no SDK, key from the
 * settings table.
 */

import type { Corpus, CorpusPost, ContentStats, HashtagStat } from "./corpus";
import {
  getAnthropicSettings,
  listModels,
  DEFAULT_MODEL,
  type AnthropicSettings,
  type AnalysisResult,
} from "./analyze";

const API_BASE = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

export { getAnthropicSettings };
export type { AnthropicSettings };

// ─── Result shape ────────────────────────────────────────────────────────────

export type HashtagPick = {
  tag: string;
  reason: string;
  /** Times the tag appears in the collected corpus. 0 = a new tag we're proposing. */
  uses: number;
  /** Average engagement of posts carrying it, or null when it's new. */
  avgEngagement: number | null;
};

export type PostStarter = {
  title: string;
  hook: string;
  format: string;
  hashtags: string[];
};

export type PostPromptResult = {
  /** One sentence: what this brief tells the writer to do differently. */
  headline: string;
  /** The paste-ready prompt. This is the product. */
  promptText: string;
  audience: string;
  voice: string;
  /** Structural rules — length, opener, CTA, media. */
  structure: string[];
  doList: string[];
  dontList: string[];
  /** Cadence recommendation, grounded in the account's own weekday numbers. */
  cadence: string;
  hashtags: {
    /** Use on every post. 3-5. */
    core: HashtagPick[];
    /** Swap in by subject. 4-8. */
    rotating: HashtagPick[];
    /** Used often here, no payoff — stop using. */
    drop: HashtagPick[];
    /** How many, where to put them, platform differences. */
    recipe: string;
  };
  starters: PostStarter[];
  notes: string[];
};

export type PostPromptOutcome = {
  result: PostPromptResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

// ─── Prompt construction ─────────────────────────────────────────────────────

function trimPost(p: CorpusPost, max = 400): string {
  const t = p.text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/**
 * Hashtags the account already uses, split by whether they beat its own median
 * engagement. Pre-computing this keeps the model from having to do arithmetic
 * and gives the Drop list an objective basis.
 */
function hashtagLedger(stats: ContentStats): string {
  if (!stats.hashtags.length) return "This account uses no hashtags at all in the collected posts.";
  const bar = stats.medianEngagement || stats.avgEngagement || 0;
  const line = (h: HashtagStat) =>
    `#${h.tag} · used ${h.count}× · avg engagement ${h.avgEngagement} · ${
      h.avgEngagement >= bar ? "AT OR ABOVE" : "BELOW"
    } this account's median (${bar}) · last used ${h.lastUsed}`;
  return stats.hashtags.slice(0, 30).map(line).join("\n");
}

function bestWeekdays(stats: ContentStats): string {
  if (!stats.byWeekday.length) return "no weekday data";
  const ranked = [...stats.byWeekday].sort((a, b) => b.avgEngagement - a.avgEngagement);
  return ranked
    .slice(0, 3)
    .map((d) => `${d.weekday} (avg ${d.avgEngagement} over ${d.count} posts)`)
    .join(", ");
}

function buildInput(
  client: { name: string; industry: string | null; website: string | null },
  corpus: Corpus,
  priorAnalysis: AnalysisResult | null
): string {
  const s = corpus.stats;
  const sample = corpus.posts.slice(0, 80);
  const L: string[] = [];

  L.push(`# Company`);
  L.push(`Name: ${client.name}`);
  if (client.industry) L.push(`Industry: ${client.industry}`);
  if (client.website) L.push(`Website: ${client.website}`);
  L.push(`This is a CAMPAIGN account — we run or advise on its content, so the brief is written for whoever drafts its next posts.`);
  L.push("");

  L.push(`# What we measured (last ${s.windowDays} days)`);
  L.push(`Posts analysed: ${s.postCount} (${s.firstPostDate} → ${s.lastPostDate})`);
  L.push(`Platforms: ${s.platforms.map((p) => `${p.platform} ${p.count} posts, avg engagement ${p.avgEngagement}`).join(" | ") || "none"}`);
  L.push(`Engagement score = likes + 3×comments + 5×shares. Average ${s.avgEngagement}, median ${s.medianEngagement}.`);
  L.push(`Media on ${s.mediaRate}% of posts. Average length ${s.avgLength} characters.`);
  L.push(`Hashtags on ${s.hashtagRate}% of posts, ${s.avgHashtagsPerPost} per post. Longest silence ${s.gapDays} days.`);
  L.push(`Strongest weekdays by average engagement: ${bestWeekdays(s)}.`);
  L.push("");

  L.push(`# Hashtag ledger (usage vs. payoff)`);
  L.push(hashtagLedger(s));
  L.push("");

  if (s.topPosts.length) {
    L.push(`# The posts that worked (copy what makes these land)`);
    for (const p of s.topPosts) {
      L.push(`[${p.date} · ${p.platform} · score ${p.engagement} · ${p.likes}L/${p.comments}C/${p.shares}S · media:${p.hasMedia}] ${trimPost(p)}`);
    }
    L.push("");
  }

  if (s.bottomPosts.length) {
    L.push(`# The posts that died (do not reproduce these)`);
    for (const p of s.bottomPosts) {
      L.push(`[${p.date} · ${p.platform} · score ${p.engagement} · media:${p.hasMedia}] ${trimPost(p, 260)}`);
    }
    L.push("");
  }

  if (priorAnalysis) {
    L.push(`# Existing editorial read of this account (from Content Intelligence — reuse it, don't contradict it)`);
    if (priorAnalysis.headline) L.push(`Headline: ${priorAnalysis.headline}`);
    if (priorAnalysis.positioning) L.push(`Positioning: ${priorAnalysis.positioning}`);
    if (priorAnalysis.audience) L.push(`Audience: ${priorAnalysis.audience}`);
    if (priorAnalysis.toneOfVoice) L.push(`Tone of voice: ${priorAnalysis.toneOfVoice}`);
    if (priorAnalysis.contentPillars?.length) L.push(`Pillars: ${priorAnalysis.contentPillars.join(", ")}`);
    if (priorAnalysis.whatWorks?.length) L.push(`What works: ${priorAnalysis.whatWorks.join(" | ")}`);
    if (priorAnalysis.whatFlops?.length) L.push(`What flops: ${priorAnalysis.whatFlops.join(" | ")}`);
    if (priorAnalysis.gaps?.length) L.push(`Uncovered subjects: ${priorAnalysis.gaps.join(" | ")}`);
    if (priorAnalysis.hashtagVerdict) L.push(`Hashtag verdict: ${priorAnalysis.hashtagVerdict}`);
    L.push("");
  }

  L.push(`# Recent post corpus (${sample.length} most recent — this is the voice to match)`);
  for (const p of sample) {
    L.push(`[${p.date} · ${p.platform} · score ${p.engagement}] ${trimPost(p, 300)}`);
  }

  return L.join("\n");
}

const SYSTEM_PROMPT = `You are a senior B2B social content strategist at Gershon Consulting. You are handed everything the platform has collected for ONE campaign account: its posts, its engagement numbers, its hashtag usage-vs-payoff ledger, and (sometimes) an existing editorial read of the account.

Your job is NOT to analyse the account again. Your job is to produce the WRITING BRIEF that whoever drafts the next posts will actually use — and, separately, the hashtag set they should use.

The centerpiece is "promptText": a complete, self-contained prompt that a person will copy and paste into an AI writing assistant to draft the account's next post. Write it so that pasting it, plus one line naming a topic, is enough to get a post that sounds like this account on its best day.

promptText requirements:
- Address the assistant directly in the second person ("You write social posts for …").
- Name the company, what it does, and who it is speaking to, concretely.
- Describe the voice with distinguishing detail, not adjectives anyone could use. Point at real patterns from the supplied posts.
- Give the structure that works HERE: opening line, length in characters, whether to use line breaks, lists, questions, emoji, links, and where the call to action goes.
- Include the hard rules: what to always do, what to never do, drawn from the posts that worked and the posts that died.
- Include the hashtag instruction: exactly which core tags to append every time and how many rotating tags to add.
- End with a placeholder line like: "Topic for this post: [DESCRIBE THE TOPIC]".
- 350-600 words. Plain text with short labelled sections. No markdown headers, no code fences, no preamble — the string must be usable exactly as-is.

Hashtag rules:
- "core" (3-5): tags to put on every post. Prefer tags this account already uses that sit AT OR ABOVE its median engagement. A brand or campaign tag can be core even with modest numbers — say so in the reason.
- "rotating" (4-8): swapped in by subject. New tags you propose are allowed here; set uses to 0 and avgEngagement to null.
- "drop" (0-6): tags the account uses repeatedly that sit BELOW its median. Only include tags that actually appear in the ledger, with their real numbers.
- Every reason must cite the real number or a real reason specific to this account. Never write generic reasoning.
- Never invent usage figures. If a tag is not in the ledger, its uses is 0 and avgEngagement is null.

Other rules:
- Be concrete and specific to THIS company throughout. Nothing that could be pasted onto another account.
- Ground the cadence recommendation in the supplied weekday and month numbers.
- Write in US English. No emoji anywhere in your output unless the account itself uses them, and say so if it does.
- If the corpus is thin (under ~15 posts), still produce the brief but say plainly in "headline" that it rests on a small sample.

Return ONLY a JSON object, no markdown fence, no prose before or after, matching exactly this shape:

{
  "headline": "one sentence: the single most important instruction this brief gives the writer",
  "promptText": "the full paste-ready prompt, plain text, 350-600 words",
  "audience": "2-3 sentences: who the next posts are being written for",
  "voice": "2-3 sentences: the voice to match, with a distinguishing detail",
  "structure": ["4 to 6 concrete structural rules: opener, length, formatting, media, CTA"],
  "doList": ["4 to 6 things to always do here, each tied to evidence"],
  "dontList": ["4 to 6 things to never do here, each tied to evidence"],
  "cadence": "2-3 sentences: how often and on which days, citing the real weekday numbers",
  "hashtags": {
    "core": [{"tag":"withoutHash","reason":"...","uses":12,"avgEngagement":48}],
    "rotating": [{"tag":"withoutHash","reason":"...","uses":0,"avgEngagement":null}],
    "drop": [{"tag":"withoutHash","reason":"...","uses":19,"avgEngagement":8}],
    "recipe": "2-3 sentences: how many tags per post, where they go, any platform difference"
  },
  "starters": [{"title":"...","hook":"the actual first line of the post","format":"e.g. customer proof, founder take, teardown","hashtags":["tag"]}],
  "notes": ["0 to 3 caveats about this brief"]
}

Provide exactly 3 starters. Tags must be written without the leading #.`;

// ─── Response handling ───────────────────────────────────────────────────────

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
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

const cleanTag = (t: string) => t.trim().replace(/^#/, "").replace(/\s+/g, "");

/**
 * Re-attach the account's real numbers to every tag the model returned.
 * The model is told not to invent figures, but the ledger is authoritative —
 * if a tag exists in the corpus we overwrite whatever it claimed.
 */
function coercePicks(v: unknown, stats: ContentStats, max: number): HashtagPick[] {
  if (!Array.isArray(v)) return [];
  const ledger = new Map(stats.hashtags.map((h) => [h.tag.toLowerCase(), h]));
  const seen = new Set<string>();
  const out: HashtagPick[] = [];

  for (const raw of v as Record<string, unknown>[]) {
    const tag = cleanTag(typeof raw?.tag === "string" ? raw.tag : "");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    const real = ledger.get(tag.toLowerCase());
    out.push({
      tag,
      reason: typeof raw?.reason === "string" ? raw.reason : "",
      uses: real ? real.count : 0,
      avgEngagement: real ? real.avgEngagement : null,
    });
    if (out.length >= max) break;
  }
  return out;
}

function coerce(raw: unknown, stats: ContentStats): PostPromptResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const h = (o.hashtags ?? {}) as Record<string, unknown>;

  const starters: PostStarter[] = Array.isArray(o.starters)
    ? (o.starters as Record<string, unknown>[]).slice(0, 4).map((s) => ({
        title: typeof s.title === "string" ? s.title : "Untitled",
        hook: typeof s.hook === "string" ? s.hook : "",
        format: typeof s.format === "string" ? s.format : "",
        hashtags: asStringArray(s.hashtags, 6).map(cleanTag),
      }))
    : [];

  return {
    headline: str("headline"),
    promptText: str("promptText"),
    audience: str("audience"),
    voice: str("voice"),
    structure: asStringArray(o.structure, 6),
    doList: asStringArray(o.doList, 6),
    dontList: asStringArray(o.dontList, 6),
    cadence: str("cadence"),
    hashtags: {
      core: coercePicks(h.core, stats, 5),
      rotating: coercePicks(h.rotating, stats, 8),
      drop: coercePicks(h.drop, stats, 6),
      recipe: typeof h.recipe === "string" ? h.recipe.trim() : "",
    },
    starters,
    notes: asStringArray(o.notes, 3),
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runPostPrompt(
  client: { name: string; industry: string | null; website: string | null },
  corpus: Corpus,
  settings: AnthropicSettings,
  priorAnalysis: AnalysisResult | null = null
): Promise<PostPromptOutcome> {
  if (!settings.apiKey) {
    throw new Error("No Anthropic API key configured. Add one in Settings → Content Intelligence (AI).");
  }

  const input = buildInput(client, corpus, priorAnalysis);
  const started = Date.now();

  async function call(model: string) {
    return fetch(`${API_BASE}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": settings.apiKey as string,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: input }],
      }),
    });
  }

  let model = settings.model || DEFAULT_MODEL;
  let res = await call(model);

  // A stale model id in settings shouldn't take the feature down.
  if (res.status === 404) {
    const models = await listModels(settings.apiKey).catch(() => []);
    const fallback = models.find((m) => /sonnet/i.test(m.id))?.id || models[0]?.id;
    if (fallback && fallback !== model) {
      model = fallback;
      res = await call(model);
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 400);
    try {
      const j = JSON.parse(body) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* keep raw */
    }
    throw new Error(`Anthropic API error ${res.status}: ${detail}`);
  }

  const payload = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };

  const text = (payload.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

  if (!text.trim()) throw new Error("Anthropic returned an empty response.");

  const result = coerce(extractJson(text), corpus.stats);
  if (!result.promptText) {
    throw new Error("The model returned no prompt text. Try regenerating.");
  }

  return {
    result,
    model: payload.model || model,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    durationMs: Date.now() - started,
  };
}
