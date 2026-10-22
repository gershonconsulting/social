/**
 * Background collection on request (v4.44.0, extension 0.19.0).
 *
 * Until now a "Collect" button only worked from a dashboard tab open in a
 * Chrome that had the extension: the page talked to the extension directly.
 * Now the dashboard puts the request in a QUEUE on the server, and every
 * Chrome running the extension checks that queue every minute (the same way
 * publishing already works, and the way the Linalysis extension works). The
 * first one free takes the job, collects in its own unfocused window, and
 * reports the result. So a collection can be started from any browser, a
 * phone included, and the work happens behind the scenes.
 *
 * Storage: one OrgSetting row per workspace, key "collect_queue", JSON:
 *   jobs   — newest last, the last MAX_JOBS kept
 *   agents — every extension install that has checked in: version + last time
 *
 * Two browsers can check in at the same moment, so every write is a
 * compare-and-swap on the row's previous text: if someone else wrote in
 * between, re-read and try again. A job is never handed out twice.
 */
import rawPrisma from "@/lib/db-raw";

export const QUEUE_KEY = "collect_queue";
const MAX_JOBS = 30;
/** A job not reported back within this time is marked failed (browser closed mid-run). */
export const RUN_TIMEOUT_MS = 45 * 60 * 1000;
/** A job nobody picked up within this time is dropped. */
export const QUEUE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
/** An agent seen within this window is counted as "listening". */
export const AGENT_LIVE_MS = 10 * 60 * 1000;
/** Only rewrite an agent's check-in time this often, to keep polls read-only most of the time. */
const AGENT_TOUCH_MS = 4 * 60 * 1000;

export type JobStatus = "queued" | "running" | "done" | "failed" | "expired";

export type CollectJob = {
  id: string;
  clientId: string | null; // null = every company
  clientName: string | null;
  /** v4.63.0: scroll much further back — the company's full recent history, not just the latest posts. */
  deep?: boolean;
  requestedAt: string;
  status: JobStatus;
  claimedAt?: string;
  claimedBy?: string;
  finishedAt?: string;
  result?: { upserted: number; failed: number; accounts: number; errors: string[] };
  error?: string;
};

export type CollectAgent = { id: string; label: string; version: string; lastSeenAt: string };

export type QueueState = { jobs: CollectJob[]; agents: Record<string, CollectAgent> };

const EMPTY: QueueState = { jobs: [], agents: {} };

type Db = typeof rawPrisma;

function newId(): string {
  return "cj_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function parse(value: string | null | undefined): QueueState {
  if (!value) return structuredClone(EMPTY);
  try {
    const j = JSON.parse(value);
    return { jobs: Array.isArray(j.jobs) ? j.jobs : [], agents: j.agents && typeof j.agents === "object" ? j.agents : {} };
  } catch {
    return structuredClone(EMPTY);
  }
}

// ── Pure state changes (unit-tested) ─────────────────────────────────────

/** Time out stuck jobs. Returns true if anything changed. */
export function expire(s: QueueState, now: number): boolean {
  let changed = false;
  for (const j of s.jobs) {
    if (j.status === "running" && j.claimedAt && now - Date.parse(j.claimedAt) > RUN_TIMEOUT_MS) {
      j.status = "failed";
      j.finishedAt = new Date(now).toISOString();
      j.error = "No result came back from the browser (closed or asleep during the run).";
      changed = true;
    } else if (j.status === "queued" && now - Date.parse(j.requestedAt) > QUEUE_TIMEOUT_MS) {
      j.status = "expired";
      j.finishedAt = new Date(now).toISOString();
      j.error = "No Chrome with the extension picked this up within 24 hours.";
      changed = true;
    }
  }
  return changed;
}

/**
 * Add a request. An identical one already waiting or running is reused; a
 * request for every company also covers single-company ones still waiting.
 */
export function enqueue(s: QueueState, clientId: string | null, clientName: string | null, now: number, deep = false): CollectJob {
  const open = s.jobs.filter((j) => j.status === "queued" || j.status === "running");
  const same = open.find((j) => j.clientId === clientId && !!j.deep === deep) || (clientId ? open.find((j) => j.clientId === null && j.status === "queued") : undefined);
  if (same) return same;
  if (clientId === null) {
    for (const j of s.jobs) {
      if (j.status === "queued" && j.clientId) {
        j.status = "expired";
        j.finishedAt = new Date(now).toISOString();
        j.error = "Covered by the request to collect every company.";
      }
    }
  }
  const job: CollectJob = { id: newId(), clientId, clientName, requestedAt: new Date(now).toISOString(), status: "queued", ...(deep ? { deep: true } : {}) };
  s.jobs.push(job);
  if (s.jobs.length > MAX_JOBS) s.jobs.splice(0, s.jobs.length - MAX_JOBS);
  return job;
}

/** Record the agent and hand it the oldest waiting job, if any. */
export function claim(s: QueueState, agent: { id: string; label: string; version: string }, now: number): { job: CollectJob | null; changed: boolean } {
  let changed = expire(s, now);
  const prev = s.agents[agent.id];
  if (!prev || prev.version !== agent.version || prev.label !== agent.label || now - Date.parse(prev.lastSeenAt) > AGENT_TOUCH_MS) {
    s.agents[agent.id] = { ...agent, lastSeenAt: new Date(now).toISOString() };
    changed = true;
  }
  // Forget installs not seen for 30 days.
  for (const [id, a] of Object.entries(s.agents)) {
    if (now - Date.parse(a.lastSeenAt) > 30 * 86400000) {
      delete s.agents[id];
      changed = true;
    }
  }
  const job = s.jobs.find((j) => j.status === "queued") || null;
  if (job) {
    job.status = "running";
    job.claimedAt = new Date(now).toISOString();
    job.claimedBy = agent.id;
    changed = true;
  }
  return { job, changed };
}

export function finish(
  s: QueueState,
  jobId: string,
  agentId: string,
  r: { ok: boolean; upserted?: number; failed?: number; accounts?: number; errors?: string[] },
  now: number,
): CollectJob | null {
  const j = s.jobs.find((x) => x.id === jobId);
  if (!j || j.claimedBy !== agentId || j.status !== "running") return null;
  j.status = r.ok ? "done" : "failed";
  j.finishedAt = new Date(now).toISOString();
  j.result = {
    upserted: Math.max(0, Number(r.upserted) || 0),
    failed: Math.max(0, Number(r.failed) || 0),
    accounts: Math.max(0, Number(r.accounts) || 0),
    errors: (r.errors || []).slice(0, 5).map((e) => String(e).slice(0, 300)),
  };
  if (!r.ok) j.error = j.result.errors[0] || "The collection did not complete.";
  return j;
}

// ── Persistence with compare-and-swap ────────────────────────────────────

async function read(db: Db, orgId: string): Promise<{ raw: string | null; state: QueueState }> {
  const row = await db.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: QUEUE_KEY } } });
  return { raw: row?.value ?? null, state: parse(row?.value) };
}

/**
 * Read → change → write, retried if another caller wrote in between.
 * `mutate` returns [result, changed]; nothing is written when unchanged.
 */
async function update<T>(db: Db, orgId: string, mutate: (s: QueueState) => [T, boolean]): Promise<T> {
  for (let attempt = 0; attempt < 15; attempt++) {
    // Lost a race: wait a short random moment so contenders spread out.
    if (attempt) await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * attempt));
    const { raw, state } = await read(db, orgId);
    const [result, changed] = mutate(state);
    if (!changed) return result;
    const value = JSON.stringify(state);
    if (raw === null) {
      try {
        await db.orgSetting.create({ data: { organizationId: orgId, key: QUEUE_KEY, value } });
        return result;
      } catch {
        continue; // someone created it first — go round again
      }
    }
    const res = await db.orgSetting.updateMany({ where: { organizationId: orgId, key: QUEUE_KEY, value: raw }, data: { value } });
    if (res.count === 1) return result;
  }
  throw new Error("The collection queue is busy — try again in a moment.");
}

export async function requestCollection(orgId: string, clientId: string | null, db: Db = rawPrisma, deep = false): Promise<CollectJob> {
  let clientName: string | null = null;
  if (clientId) {
    const c = await db.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { name: true } });
    if (!c) throw new Error("Company not found in this workspace.");
    clientName = c.name;
  }
  return update(db, orgId, (s) => {
    const before = JSON.stringify(s);
    const job = enqueue(s, clientId, clientName, Date.now(), deep);
    return [structuredClone(job), JSON.stringify(s) !== before];
  });
}

export async function claimNext(orgId: string, agent: { id: string; label: string; version: string }, db: Db = rawPrisma): Promise<CollectJob | null> {
  return update(db, orgId, (s) => {
    const { job, changed } = claim(s, agent, Date.now());
    return [job ? structuredClone(job) : null, changed];
  });
}

export async function reportResult(
  orgId: string,
  jobId: string,
  agentId: string,
  r: { ok: boolean; upserted?: number; failed?: number; accounts?: number; errors?: string[] },
  db: Db = rawPrisma,
): Promise<CollectJob | null> {
  return update(db, orgId, (s) => {
    const j = finish(s, jobId, agentId, r, Date.now());
    return [j ? structuredClone(j) : null, !!j];
  });
}

export type QueueView = {
  jobs: CollectJob[];
  agents: (CollectAgent & { live: boolean })[];
  listening: number;
};

export async function queueStatus(orgId: string, db: Db = rawPrisma): Promise<QueueView> {
  const { state } = await read(db, orgId);
  const now = Date.now();
  expire(state, now); // for display only; the next write persists it
  const agents = Object.values(state.agents)
    .map((a) => ({ ...a, live: now - Date.parse(a.lastSeenAt) <= AGENT_LIVE_MS }))
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  return { jobs: state.jobs.slice().reverse(), agents, listening: agents.filter((a) => a.live).length };
}
