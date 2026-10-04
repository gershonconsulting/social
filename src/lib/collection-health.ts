/**
 * LinkedIn collection health — the "LinkedIn changed its page again" alarm.
 *
 * Olivier, 2026-10-04: Cytel showed "Has never posted" while it posts every
 * week. LinkedIn had changed its company-page layout and the collector read
 * zero posts from EVERY company, silently. One company with no posts is
 * normal; every company at once is not — that is a broken reader, and it must
 * be loud.
 *
 * Every LinkedIn result the extension sends is noted per company (post count
 * or error) in OrgSetting "linkedin_health". When, over the last 36 hours, at
 * least 3 companies reported and ALL of them came back with zero posts, the
 * workspace is in alarm and every dashboard page shows a red strip. The first
 * company that returns posts clears it.
 */
import prisma from "@/lib/db-raw";

const KEY = "linkedin_health";
const WINDOW_MS = 36 * 3600 * 1000;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const MIN_COMPANIES = 3;

type Entry = { at: number; n: number; err?: string };
type Health = Record<string, Entry>;

export type LinkedInAlarm = {
  since: string;
  companies: number;
  sampleError: string | null;
};

async function read(orgId: string): Promise<Health> {
  const row = await prisma.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: KEY } },
  });
  if (!row?.value) return {};
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === "object" ? (v as Health) : {};
  } catch {
    return {};
  }
}

/** Note what each LinkedIn company returned in this batch. Never throws. */
export async function recordLinkedInResults(
  orgId: string,
  results: Array<{ connectionId: string; n: number; error?: string | null }>,
): Promise<void> {
  if (!results.length) return;
  try {
    const now = Date.now();
    const h = await read(orgId);
    for (const r of results) {
      h[r.connectionId] = { at: now, n: r.n, ...(r.error ? { err: r.error.slice(0, 160) } : {}) };
    }
    for (const k of Object.keys(h)) if (now - h[k].at > KEEP_MS) delete h[k];
    const value = JSON.stringify(h);
    await prisma.orgSetting.upsert({
      where: { organizationId_key: { organizationId: orgId, key: KEY } },
      create: { organizationId: orgId, key: KEY, value },
      update: { value },
    });
  } catch {
    // Bookkeeping must never fail a collection run.
  }
}

/** The alarm, or null when LinkedIn collection looks healthy. */
export async function getLinkedInAlarm(orgId: string): Promise<LinkedInAlarm | null> {
  const h = await read(orgId);
  const now = Date.now();
  const recent = Object.values(h).filter((e) => now - e.at <= WINDOW_MS);
  if (recent.length < MIN_COMPANIES) return null;
  if (recent.some((e) => e.n > 0)) return null;
  const since = Math.min(...recent.map((e) => e.at));
  const withErr = recent.find((e) => e.err);
  return {
    since: new Date(since).toISOString(),
    companies: recent.length,
    sampleError: withErr?.err ?? null,
  };
}
