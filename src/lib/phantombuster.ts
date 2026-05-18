/**
 * Phantombuster API client.
 *
 * Olivier subscribes to Phantombuster — pre-configured "phantoms" (their
 * scraping automations) handle the actual browser automation against
 * X / Twitter and LinkedIn. We just trigger them, wait for completion,
 * download the CSV result, and parse rows into our SocialPost schema.
 *
 * API: https://api.phantombuster.com/api/v2
 * Auth header: x-phantombuster-key
 */

import prisma from "@/lib/db";

const PB_BASE = "https://api.phantombuster.com/api/v2";

export interface PhantombusterConfig {
  apiKey: string;
  twitterPhantomId: string | null;
  linkedinPhantomId: string | null;
  deleteAfterRun: boolean;
}

/**
 * Read the saved Phantombuster configuration from the Setting table.
 * Returns null when nothing is configured yet.
 */
export async function getPbConfig(): Promise<PhantombusterConfig | null> {
  const row = await prisma.setting.findUnique({ where: { key: "phantombuster" } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<PhantombusterConfig>;
    if (!parsed.apiKey) return null;
    return {
      apiKey: parsed.apiKey,
      twitterPhantomId: parsed.twitterPhantomId ?? null,
      linkedinPhantomId: parsed.linkedinPhantomId ?? null,
      deleteAfterRun: !!parsed.deleteAfterRun,
    };
  } catch {
    return null;
  }
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    "x-phantombuster-key": apiKey,
    "Content-Type": "application/json",
  };
}

/**
 * Launch a Phantom by ID. Returns the containerId of the launched run.
 * Uses the phantom's pre-saved configuration (session cookie, target URLs,
 * etc.) — the user configures these once in the Phantombuster UI.
 */
export async function launchPhantom(
  apiKey: string,
  phantomId: string,
  argumentOverride?: Record<string, unknown>
): Promise<{ containerId: string | null; rawStatus: number; bodyHead?: string }> {
  const body: Record<string, unknown> = { id: phantomId };
  if (argumentOverride) body.argument = argumentOverride;
  const r = await fetch(`${PB_BASE}/agents/launch`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) return { containerId: null, rawStatus: r.status, bodyHead: text.slice(0, 200) };
  try {
    const j = JSON.parse(text) as { data?: { containerId?: string }; containerId?: string };
    const containerId = j.data?.containerId ?? j.containerId ?? null;
    return { containerId: containerId ? String(containerId) : null, rawStatus: r.status };
  } catch {
    return { containerId: null, rawStatus: r.status, bodyHead: text.slice(0, 200) };
  }
}

/**
 * Poll the agent's metadata until its lastEndStatus stops being "running".
 * Returns the final agent JSON or null on timeout.
 */
export async function waitForPhantomFinish(
  apiKey: string,
  phantomId: string,
  timeoutMs = 120_000,
  pollIntervalMs = 4_000
): Promise<{ lastEndStatus: string | null; resultObjectUrl: string | null; rawAgent: unknown }> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${PB_BASE}/agents/fetch?id=${encodeURIComponent(phantomId)}`, {
        headers: { "x-phantombuster-key": apiKey },
      });
      if (r.ok) {
        // PB /agents/fetch returns the agent fields at the ROOT of the JSON
        // (not nested in `data`). Some endpoints do wrap in `data`, so we
        // accept both shapes for safety.
        const j = (await r.json()) as { lastEndType?: string; s3Folder?: string; orgS3Folder?: string; data?: { lastEndType?: string; s3Folder?: string; orgS3Folder?: string } };
        const flat = (j.data ?? j) as { lastEndType?: string; s3Folder?: string; orgS3Folder?: string };
        last = flat;
        const status = (flat.lastEndType ?? null) as string | null;
        if (status && status !== "running") {
          // Build candidate result CSV URLs. PB writes the full result file
          // under the saved csvName argument (e.g. "Twitter Media
          // Extractor.csv", 1MB+ of real data). The legacy "result.csv"
          // path exists too but is just an error-log summary — using it
          // makes us think we got 0 rows. Try the csvName URL first.
          const orgFolder = (flat as { orgS3Folder?: string }).orgS3Folder;
          const s3Folder = (flat as { s3Folder?: string }).s3Folder;
          // Pull csvName out of the saved argument JSON if present.
          const argRaw = (flat as { argument?: string }).argument;
          let csvName: string | null = null;
          if (typeof argRaw === "string") {
            try {
              const parsed = JSON.parse(argRaw) as { csvName?: string };
              if (parsed && typeof parsed.csvName === "string" && parsed.csvName.trim()) {
                csvName = parsed.csvName.trim();
              }
            } catch { /* ignore */ }
          }
          let resultObjectUrl: string | null = null;
          if (orgFolder && s3Folder) {
            const base = `https://phantombuster.s3.amazonaws.com/${orgFolder}/${s3Folder}`;
            resultObjectUrl = csvName
              ? `${base}/${encodeURIComponent(csvName)}.csv`
              : `${base}/result.csv`;
          }
          return { lastEndStatus: status, resultObjectUrl, rawAgent: last };
        }
      }
    } catch {
      // ignore — we'll retry until deadline
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return { lastEndStatus: "timeout", resultObjectUrl: null, rawAgent: last };
}

/**
 * Download a result CSV file (typically from phantombuster.s3.amazonaws.com).
 */
export async function downloadCsv(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

/**
 * Tiny CSV parser that handles quoted fields and embedded newlines/commas
 * — the Phantombuster Twitter Media Extractor output puts multi-line tweet
 * text inside double-quoted cells, so we can't just .split(",").
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") {
        row.push(cell); cell = "";
        rows.push(row); row = [];
      } else if (c === "\r") {
        // skip
      } else {
        cell += c;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Delete an agent (phantom). Used when the user enabled deleteAfterRun.
 */
export async function deletePhantom(apiKey: string, phantomId: string): Promise<boolean> {
  try {
    const r = await fetch(`${PB_BASE}/agents/delete`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ id: phantomId }),
    });
    return r.ok;
  } catch {
    return false;
  }
}


/**
 * Fetch the saved argument object for a Phantom (the args the user
 * configured in the PB UI). Returns the parsed object, or {} on failure.
 * Used to merge per-launch overrides on top of saved fields like
 * sessionCookie / userAgent / activitiesToScrape.
 */
export async function fetchAgentSavedArgument(
  apiKey: string,
  phantomId: string
): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${PB_BASE}/agents/fetch?id=${encodeURIComponent(phantomId)}`, {
      headers: { "x-phantombuster-key": apiKey },
    });
    if (!r.ok) return {};
    const j = (await r.json()) as { argument?: string; data?: { argument?: string } };
    const flat = (j.data ?? j) as { argument?: string };
    if (!flat.argument) return {};
    if (typeof flat.argument === "string") {
      try {
        return JSON.parse(flat.argument) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return flat.argument as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Fetch a specific run's container metadata (status + exitCode + endType).
 */
export async function fetchContainer(
  apiKey: string,
  containerId: string
): Promise<{ status: string | null; exitCode: number | null; endType: string | null }> {
  try {
    const r = await fetch(`${PB_BASE}/containers/fetch?id=${encodeURIComponent(containerId)}`, {
      headers: { "x-phantombuster-key": apiKey },
    });
    if (!r.ok) return { status: null, exitCode: null, endType: null };
    const j = (await r.json()) as { status?: string; exitCode?: number; endType?: string; data?: { status?: string; exitCode?: number; endType?: string } };
    const flat = (j.data ?? j) as { status?: string; exitCode?: number; endType?: string };
    return { status: flat.status ?? null, exitCode: flat.exitCode ?? null, endType: flat.endType ?? null };
  } catch {
    return { status: null, exitCode: null, endType: null };
  }
}

/**
 * Fetch the freshly-scraped resultObject for a specific phantom run.
 * Returns the parsed JSON array (the actual scraped records), or null on
 * failure / empty / cookie-expired runs.
 */
export async function fetchContainerResultObject(
  apiKey: string,
  containerId: string
): Promise<unknown[] | null> {
  try {
    const r = await fetch(`${PB_BASE}/containers/fetch-result-object?id=${encodeURIComponent(containerId)}`, {
      headers: { "x-phantombuster-key": apiKey },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { resultObject?: string | unknown[] | null; data?: { resultObject?: string | unknown[] | null } };
    const flat = (j.data ?? j) as { resultObject?: string | unknown[] | null };
    if (flat.resultObject == null) return null;
    if (typeof flat.resultObject === "string") {
      try { return JSON.parse(flat.resultObject) as unknown[]; } catch { return null; }
    }
    return flat.resultObject as unknown[];
  } catch {
    return null;
  }
}

