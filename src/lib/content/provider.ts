/**
 * AI provider layer — Cloudflare Workers AI only (v4.29.0).
 *
 * Content Intelligence, Post Studio and the Competitor brief all need one thing
 * from a model: send a system prompt plus a big user payload, get JSON back.
 * Since v4.29.0 every call runs on Cloudflare Workers AI through the `AI`
 * binding declared in wrangler.toml. No Anthropic / OpenAI key, no vendor
 * account, nothing to paste in Settings — the binding is the credential.
 *
 * The only stored setting is an optional model override (`settings` row
 * `cloudflare_ai` → {model}). If that model is retired by Cloudflare the call
 * falls through the FALLBACK_MODELS chain instead of taking the feature down.
 */

import prisma from "@/lib/db";
import { getRequestContext } from "@cloudflare/next-on-pages";

export type AIProvider = "cloudflare";

/** Large context (131k) so a full company corpus fits in one call. */
export const DEFAULT_CF_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
/** @deprecated back-compat name used by analyze.ts — now the Cloudflare default. */
export const DEFAULT_ANTHROPIC_MODEL = DEFAULT_CF_MODEL;

/** Tried in order after the configured model if Cloudflare rejects it. */
const FALLBACK_MODELS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
];

const MODEL_SETTING = "cloudflare_ai";

export type AISettings = {
  provider: AIProvider;
  /** True when the Workers AI binding is present in this request. */
  available: boolean;
  model: string;
  source: "binding" | "none";
  /**
   * Kept for the call sites that still test `settings.apiKey` — truthy when
   * the binding is there. Never a real key.
   */
  apiKey: string | null;
};

type WorkersAI = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

export function providerLabel(_p: AIProvider = "cloudflare"): string {
  return "Cloudflare Workers AI";
}

export function defaultModelFor(_p: AIProvider = "cloudflare"): string {
  return DEFAULT_CF_MODEL;
}

/** The Workers AI binding, or null outside a Cloudflare request (build, tests). */
export function getAIBinding(): WorkersAI | null {
  try {
    const env = getRequestContext().env as unknown as { AI?: WorkersAI };
    return env.AI ?? null;
  } catch {
    return null;
  }
}

async function readModel(): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: MODEL_SETTING } });
    if (!row) return null;
    const v = JSON.parse(row.value) as { model?: string };
    return v.model && v.model.startsWith("@cf/") ? v.model : null;
  } catch {
    return null;
  }
}

export async function setModel(model: string): Promise<void> {
  const value = JSON.stringify({ model });
  await prisma.setting.upsert({
    where: { key: MODEL_SETTING },
    update: { value },
    create: { key: MODEL_SETTING, value },
  });
}

export async function getAISettings(): Promise<AISettings> {
  const ai = getAIBinding();
  const model = (await readModel()) || DEFAULT_CF_MODEL;
  return {
    provider: "cloudflare",
    available: !!ai,
    model,
    source: ai ? "binding" : "none",
    apiKey: ai ? "cloudflare-binding" : null,
  };
}

/** Back-compat alias for older call sites. */
export const getProviderSettings = async (_p?: unknown) => getAISettings();

export type ModelInfo = { id: string; display_name?: string };

/** Models offered in the Settings dropdown. */
export async function listModels(): Promise<ModelInfo[]> {
  return FALLBACK_MODELS.map((id) => ({ id }));
}

// ─── The one call every engine makes ─────────────────────────────────────────

export type ChatOutcome = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

function asText(response: unknown): string {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") return JSON.stringify(response);
  return "";
}

/**
 * Send one system+user pair, get text back. If the chosen model is rejected
 * (retired id, context too long, capacity) the next model in the chain is tried.
 */
export async function runChat(
  settings: AISettings,
  system: string,
  user: string,
  maxTokens = 6000
): Promise<ChatOutcome> {
  const ai = getAIBinding();
  if (!ai) {
    throw new Error(
      "Cloudflare Workers AI binding (AI) is not available on this deployment. Check wrangler.toml [ai] binding."
    );
  }

  const chain = [settings.model || DEFAULT_CF_MODEL, ...FALLBACK_MODELS].filter(
    (m, i, a) => a.indexOf(m) === i
  );
  const errors: string[] = [];

  for (const model of chain) {
    try {
      const out = (await ai.run(model, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.4,
      })) as { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };

      const text = asText(out?.response);
      if (!text.trim()) {
        errors.push(`${model}: empty response`);
        continue;
      }
      return {
        text,
        model,
        inputTokens: out?.usage?.prompt_tokens ?? 0,
        outputTokens: out?.usage?.completion_tokens ?? 0,
      };
    } catch (e) {
      errors.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(`Cloudflare Workers AI failed on every model. ${errors.join(" | ").slice(0, 600)}`);
}

/** Tiny live call used by Settings to show the green check. */
export async function pingAI(): Promise<{ ok: boolean; model: string; error?: string }> {
  const settings = await getAISettings();
  if (!settings.available) return { ok: false, model: settings.model, error: "AI binding missing" };
  try {
    const r = await runChat(settings, "Reply with the single word OK.", "ping", 5);
    return { ok: true, model: r.model };
  } catch (e) {
    return { ok: false, model: settings.model, error: e instanceof Error ? e.message : String(e) };
  }
}
