/**
 * Streak CRM API client.
 *
 * Streak is our CRM inside Gmail. Its data model is two levels:
 *   - Pipeline: a board/process (one of ours represents clients/accounts).
 *   - Box:      one record inside a pipeline. Each client = one Box; the
 *               Box's `name` is the client's name, and `stageKey` is the
 *               column/stage it sits in (Lead, Active, Churned, ...).
 *
 * So "current clients" = boxes in our client pipeline whose stageKey is one
 * of the configured "current/active" stages.
 *
 * Auth: HTTP Basic — the API key is the username, password is empty.
 * All calls go over HTTPS to api.streak.com.
 *
 * Config (apiKey, pipelineKey, current stages) is read from the Setting table
 * (key "streak"), set from Settings → Streak in the app. Env vars
 * (STREAK_API_KEY / STREAK_CLIENT_PIPELINE_KEY / STREAK_CURRENT_STAGE_KEYS)
 * are used as a fallback so the sync also works from a pure-env deploy.
 *
 * Docs: https://streak.readme.io/
 */

import prisma from "@/lib/db";

const STREAK_BASE = "https://api.streak.com/api/v1";
const SETTING_KEY = "streak";

export type StreakStage = { key?: string; name?: string };

export type StreakPipeline = {
  pipelineKey: string;
  name: string;
  stages?: Record<string, StreakStage>; // stageKey -> { name }
  stageOrder?: string[];
};

export type StreakBox = {
  boxKey: string;
  name?: string;
  stageKey?: string;
  creationTimestamp?: number;
  lastUpdatedTimestamp?: number;
  fields?: Record<string, unknown>;
  [k: string]: unknown;
};

export type StreakConfig = {
  apiKey: string;
  pipelineKey: string | null;
  currentStages: string[];
};

/**
 * Resolve Streak config from the Setting table, falling back to env vars.
 * Returns null when no API key is configured anywhere.
 */
export async function getStreakConfig(): Promise<StreakConfig | null> {
  let apiKey: string | undefined;
  let pipelineKey: string | null | undefined;
  let currentStages: string[] | undefined;

  try {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row) {
      const parsed = JSON.parse(row.value) as {
        apiKey?: string;
        pipelineKey?: string | null;
        currentStageKeys?: string[] | string | null;
      };
      apiKey = parsed.apiKey || undefined;
      pipelineKey = parsed.pipelineKey ?? undefined;
      if (Array.isArray(parsed.currentStageKeys)) {
        currentStages = parsed.currentStageKeys.map((s) => s.trim()).filter(Boolean);
      } else if (typeof parsed.currentStageKeys === "string") {
        currentStages = parsed.currentStageKeys.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
  } catch {
    // Setting table may be unreachable; fall through to env.
  }

  apiKey = apiKey ?? process.env.STREAK_API_KEY;
  if (!apiKey) return null;

  pipelineKey = pipelineKey ?? process.env.STREAK_CLIENT_PIPELINE_KEY ?? null;
  if (currentStages === undefined) {
    currentStages = process.env.STREAK_CURRENT_STAGE_KEYS
      ? process.env.STREAK_CURRENT_STAGE_KEYS.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  }

  return { apiKey, pipelineKey, currentStages };
}

function authHeader(apiKey: string): string {
  // Basic auth: username = API key, password = empty ("key:").
  const token =
    typeof btoa === "function"
      ? btoa(`${apiKey}:`)
      : Buffer.from(`${apiKey}:`).toString("base64");
  return `Basic ${token}`;
}

async function streakGet<T>(apiKey: string, path: string): Promise<T> {
  const res = await fetch(`${STREAK_BASE}${path}`, {
    headers: { Authorization: authHeader(apiKey) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Streak GET ${path} failed: ${res.status} ${res.statusText}${
        body ? ` — ${body.slice(0, 300)}` : ""
      }`,
    );
  }
  return (await res.json()) as T;
}

/** List every pipeline (board). Use to discover the client pipeline key + stages. */
export function listPipelines(apiKey: string): Promise<StreakPipeline[]> {
  return streakGet<StreakPipeline[]>(apiKey, "/pipelines");
}

/** List every box (record) in a given pipeline. */
export function listBoxes(apiKey: string, pipelineKey: string): Promise<StreakBox[]> {
  return streakGet<StreakBox[]>(apiKey, `/pipelines/${encodeURIComponent(pipelineKey)}/boxes`);
}

export type CurrentClient = {
  boxKey: string;
  name: string;
  stageKey?: string;
};

/**
 * Fetch current clients from the configured client pipeline.
 * Uses the resolved StreakConfig (Setting table → env fallback).
 */
export async function fetchCurrentClients(cfg: StreakConfig): Promise<CurrentClient[]> {
  if (!cfg.pipelineKey) {
    throw new Error("No Streak pipeline configured — set it in Settings → Streak.");
  }
  const boxes = await listBoxes(cfg.apiKey, cfg.pipelineKey);
  return boxes
    .filter((b) => {
      if (cfg.currentStages.length === 0) return true; // no filter -> everyone
      return b.stageKey != null && cfg.currentStages.includes(b.stageKey);
    })
    .map((b) => ({
      boxKey: b.boxKey,
      name: (b.name ?? "").trim(), // free-text: strip stray whitespace
      stageKey: b.stageKey,
    }))
    .filter((c) => Boolean(c.boxKey) && Boolean(c.name));
}
