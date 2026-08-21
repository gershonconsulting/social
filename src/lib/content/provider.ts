/**
 * AI provider layer.
 *
 * Content Intelligence and Post Studio both need one thing from a model: send a
 * system prompt plus a big user payload, get JSON back. This module is the only
 * place that knows *which* vendor answers that call, so adding a provider never
 * touches the prompts.
 *
 * Keys live in the `settings` table (rotatable from the Settings page without a
 * redeploy) with env vars as a fallback. Everything here is plain `fetch` so it
 * stays edge-runtime safe on Cloudflare Pages.
 */

import prisma from "@/lib/db";

export type AIProvider = "anthropic" | "openai";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";
export const DEFAULT_OPENAI_MODEL = "gpt-4o";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_BASE = "https://api.openai.com/v1";

const SETTING_KEYS: Record<AIProvider, string> = {
  anthropic: "anthropic",
  openai: "openai",
};

/** Which provider the app should use when both are configured. */
const PROVIDER_SETTING = "ai_provider";

export type AISettings = {
  provider: AIProvider;
  apiKey: string | null;
  model: string;
  source: "settings" | "env" | "none";
};

export function defaultModelFor(provider: AIProvider): string {
  return provider === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL;
}

export function providerLabel(provider: AIProvider): string {
  return provider === "openai" ? "OpenAI" : "Anthropic";
}

async function readStored(provider: AIProvider): Promise<{ apiKey?: string; model?: string }> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEYS[provider] } });
    if (!row) return {};
    return JSON.parse(row.value) as { apiKey?: string; model?: string };
  } catch {
    return {};
  }
}

function envKeyFor(provider: AIProvider): string | undefined {
  return provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
}

/** Settings for one specific provider, ignoring which one is active. */
export async function getProviderSettings(provider: AIProvider): Promise<AISettings> {
  const stored = await readStored(provider);
  if (stored.apiKey) {
    return {
      provider,
      apiKey: stored.apiKey,
      model: stored.model || defaultModelFor(provider),
      source: "settings",
    };
  }
  const env = envKeyFor(provider);
  if (env) {
    return { provider, apiKey: env, model: stored.model || defaultModelFor(provider), source: "env" };
  }
  return { provider, apiKey: null, model: defaultModelFor(provider), source: "none" };
}

/** The explicitly chosen provider, if someone picked one in Settings. */
export async function getPreferredProvider(): Promise<AIProvider | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: PROVIDER_SETTING } });
    if (!row) return null;
    const parsed = JSON.parse(row.value) as { provider?: string };
    return parsed.provider === "openai" || parsed.provider === "anthropic" ? parsed.provider : null;
  } catch {
    return null;
  }
}

export async function setPreferredProvider(provider: AIProvider): Promise<void> {
  const value = JSON.stringify({ provider });
  await prisma.setting.upsert({
    where: { key: PROVIDER_SETTING },
    update: { value },
    create: { key: PROVIDER_SETTING, value },
  });
}

/**
 * The settings the engines actually run with.
 *
 * Honours an explicit choice when that provider has a key; otherwise falls back
 * to whichever provider IS configured. That last part matters: pasting one key
 * should be enough to turn the feature on, without also having to remember to
 * flip a provider switch.
 */
export async function getAISettings(): Promise<AISettings> {
  const preferred = await getPreferredProvider();

  if (preferred) {
    const chosen = await getProviderSettings(preferred);
    if (chosen.apiKey) return chosen;
  }

  const anthropic = await getProviderSettings("anthropic");
  if (anthropic.apiKey) return anthropic;

  const openai = await getProviderSettings("openai");
  if (openai.apiKey) return openai;

  return {
    provider: preferred ?? "anthropic",
    apiKey: null,
    model: defaultModelFor(preferred ?? "anthropic"),
    source: "none",
  };
}

// ─── Model listing ───────────────────────────────────────────────────────────

export type ModelInfo = { id: string; display_name?: string };

export async function listModels(provider: AIProvider, apiKey: string): Promise<ModelInfo[]> {
  if (provider === "openai") {
    const r = await fetch(`${OPENAI_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`OpenAI /models returned ${r.status}. ${body.slice(0, 300)}`);
    }
    const j = (await r.json()) as { data?: Array<{ id: string }> };
    // Chat-capable ids only — the raw list also carries embeddings, TTS, moderation
    // and image models, none of which can answer a prompt.
    return (j.data ?? [])
      .filter((m) => /^(gpt|o[1-9]|chatgpt)/i.test(m.id))
      .filter((m) => !/(embedding|whisper|tts|audio|realtime|image|dall|moderation|transcribe)/i.test(m.id))
      .map((m) => ({ id: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  const r = await fetch(`${ANTHROPIC_BASE}/models?limit=40`, {
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Anthropic /models returned ${r.status}. ${body.slice(0, 300)}`);
  }
  const j = (await r.json()) as { data?: ModelInfo[] };
  return j.data ?? [];
}

/** Cheap credential check used before a key is written to the settings table. */
export async function verifyKey(provider: AIProvider, apiKey: string): Promise<void> {
  await listModels(provider, apiKey);
}

// ─── The one call both engines make ──────────────────────────────────────────

export type ChatOutcome = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function errorDetail(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message;
  } catch {
    /* keep raw */
  }
  return body.slice(0, 400);
}

async function callAnthropic(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number
): Promise<Response> {
  return fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
}

async function callOpenAI(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  tokenField: "max_completion_tokens" | "max_tokens"
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // Both engines demand a bare JSON object; asking for it explicitly removes
    // the whole class of "wrapped the object in a sentence" failures.
    response_format: { type: "json_object" },
  };
  body[tokenField] = maxTokens;

  return fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Send one system+user pair, get text back. Handles the two vendor quirks that
 * would otherwise take the feature down:
 *   • a stale model id saved in settings (404) → retry on a live model
 *   • newer OpenAI models rejecting `max_tokens` → retry with
 *     `max_completion_tokens`, and vice versa for older ones
 */
export async function runChat(
  settings: AISettings,
  system: string,
  user: string,
  maxTokens = 6000
): Promise<ChatOutcome> {
  if (!settings.apiKey) {
    throw new Error(
      `No ${providerLabel(settings.provider)} API key configured. Add one in Settings → Content Intelligence (AI).`
    );
  }

  const apiKey = settings.apiKey;
  let model = settings.model || defaultModelFor(settings.provider);
  let res: Response;

  if (settings.provider === "openai") {
    let tokenField: "max_completion_tokens" | "max_tokens" = "max_completion_tokens";
    res = await callOpenAI(apiKey, model, system, user, maxTokens, tokenField);

    if (res.status === 400) {
      const body = await res.clone().text().catch(() => "");
      if (/max_completion_tokens|max_tokens/i.test(body)) {
        tokenField = tokenField === "max_completion_tokens" ? "max_tokens" : "max_completion_tokens";
        res = await callOpenAI(apiKey, model, system, user, maxTokens, tokenField);
      }
    }

    if (res.status === 404) {
      const models = await listModels("openai", apiKey).catch(() => [] as ModelInfo[]);
      const fallback =
        models.find((m) => /^gpt-4o$/i.test(m.id))?.id ||
        models.find((m) => /^gpt-4o/i.test(m.id))?.id ||
        models.find((m) => /^gpt/i.test(m.id))?.id ||
        models[0]?.id;
      if (fallback && fallback !== model) {
        model = fallback;
        res = await callOpenAI(apiKey, model, system, user, maxTokens, tokenField);
      }
    }
  } else {
    res = await callAnthropic(apiKey, model, system, user, maxTokens);

    if (res.status === 404) {
      const models = await listModels("anthropic", apiKey).catch(() => [] as ModelInfo[]);
      const fallback = models.find((m) => /sonnet/i.test(m.id))?.id || models[0]?.id;
      if (fallback && fallback !== model) {
        model = fallback;
        res = await callAnthropic(apiKey, model, system, user, maxTokens);
      }
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `${providerLabel(settings.provider)} API error ${res.status}: ${errorDetail(body)}`
    );
  }

  if (settings.provider === "openai") {
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const text = payload.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("OpenAI returned an empty response.");
    return {
      text,
      model: payload.model || model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    };
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

  return {
    text,
    model: payload.model || model,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
  };
}
