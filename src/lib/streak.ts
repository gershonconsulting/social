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
 * All calls go over HTTPS to api.streak.com. The key is read from the
 * STREAK_API_KEY env var and must never reach the browser (server-only).
 *
 * Docs: https://streak.readme.io/
 */

const STREAK_BASE = "https://api.streak.com/api/v1";

export type StreakStage = { key?: string; name?: string };

export type StreakPipeline = {
  pipelineKey: string;
  name: string;
  // stageKey -> { name }
  stages?: Record<string, StreakStage>;
  stageOrder?: string[];
};

export type StreakBox = {
  boxKey: string;
  name?: string;
  stageKey?: string;
  creationTimestamp?: number;
  lastUpdatedTimestamp?: number;
  // Streak also returns arbitrary custom fields; keep them addressable.
  fields?: Record<string, unknown>;
  [k: string]: unknown;
};

function authHeader(): string {
  const key = process.env.STREAK_API_KEY;
  if (!key) {
    throw new Error("STREAK_API_KEY is not set");
  }
  // Basic auth: username = API key, password = empty ("key:").
  const token =
    typeof btoa === "function"
      ? btoa(`${key}:`)
      : Buffer.from(`${key}:`).toString("base64");
  return `Basic ${token}`;
}

async function streakGet<T>(path: string): Promise<T> {
  const res = await fetch(`${STREAK_BASE}${path}`, {
    headers: { Authorization: authHeader() },
    // Never cache CRM reads.
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

/** List every pipeline (board) on the account. Use to discover the client pipeline key + stages. */
export function listPipelines(): Promise<StreakPipeline[]> {
  return streakGet<StreakPipeline[]>("/pipelines");
}

/** List every box (record) in a given pipeline. */
export function listBoxes(pipelineKey: string): Promise<StreakBox[]> {
  return streakGet<StreakBox[]>(
    `/pipelines/${encodeURIComponent(pipelineKey)}/boxes`,
  );
}

export type CurrentClient = {
  boxKey: string;
  name: string;
  stageKey?: string;
};

/**
 * Fetch current clients from the configured client pipeline.
 *
 * @param opts.pipelineKey   Streak pipeline key. Defaults to STREAK_CLIENT_PIPELINE_KEY env.
 * @param opts.currentStages Stage keys that count as "current". Defaults to
 *                           STREAK_CURRENT_STAGE_KEYS env (comma-separated).
 *                           If empty/undefined, ALL boxes are returned (no stage filter).
 */
export async function fetchCurrentClients(opts?: {
  pipelineKey?: string;
  currentStages?: string[];
}): Promise<CurrentClient[]> {
  const pipelineKey = opts?.pipelineKey ?? process.env.STREAK_CLIENT_PIPELINE_KEY;
  if (!pipelineKey) {
    throw new Error(
      "No pipeline key: pass pipelineKey or set STREAK_CLIENT_PIPELINE_KEY",
    );
  }

  const currentStages =
    opts?.currentStages ??
    (process.env.STREAK_CURRENT_STAGE_KEYS
      ? process.env.STREAK_CURRENT_STAGE_KEYS.split(",").map((s) => s.trim()).filter(Boolean)
      : []);

  const boxes = await listBoxes(pipelineKey);

  return boxes
    .filter((b) => {
      if (currentStages.length === 0) return true; // no filter -> everyone
      return b.stageKey != null && currentStages.includes(b.stageKey);
    })
    .map((b) => ({
      boxKey: b.boxKey,
      // Box name is free-text: trim stray whitespace/emoji padding.
      name: (b.name ?? "").trim(),
      stageKey: b.stageKey,
    }))
    .filter((c) => Boolean(c.boxKey) && Boolean(c.name));
}
