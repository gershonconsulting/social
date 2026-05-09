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
        const j = (await r.json()) as { data?: { lastEndStatus?: string; s3Folder?: string; userAwsFolder?: string } };
        last = j.data ?? j;
        const status = (j.data?.lastEndStatus ?? null) as string | null;
        if (status && status !== "running") {
          // Build the canonical result-object URL for this agent run
          const userFolder = j.data?.userAwsFolder;
          const s3Folder = j.data?.s3Folder;
          const resultObjectUrl = userFolder && s3Folder
            ? `https://phantombuster.s3.amazonaws.com/${userFolder}/${s3Folder}/result.csv`
            : null;
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
