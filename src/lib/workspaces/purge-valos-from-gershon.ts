/**
 * One-shot: take VALOS's companies OUT of the Gershon workspace.
 *
 * Olivier, 2026-10-04: "I run a collection for olivier@attia.com and you
 * collected data from companies from Valos! Imagine a bank showing the data
 * from another client's account!"
 *
 * Cause: Competitor Watch (v4.11.0) and valos-coverage (v4.22.0) created
 * VALOS's competitors and its partner as COMPETITION / PARTNER companies
 * inside the PRIMARY (Gershon) workspace, so Olivier's extension collected
 * them as if they were his. They belong to the VALOS workspace only, which
 * already has its own copies (seed-valos.ts).
 *
 * What is removed from the Gershon workspace, with every post, connection,
 * snapshot and analysis hanging off them:
 *   - every company in VALOS's Competitor Watch list there, and
 *   - every company whose LinkedIn page is on the VALOS list below,
 *   but ONLY when it is COMPETITION or PARTNER. A Gershon CLIENT / CAMPAIGN /
 *   INTERNAL / RECYCLED company is never touched — VALOS itself stays, it is
 *   a Gershon campaign client.
 * Plus VALOS's competitor links / briefs in the Gershon workspace, and every
 * mirror link (copying between workspaces is switched off).
 *
 * Every delete is pinned to the primary organizationId. Dmitri's VALOS
 * workspace is not touched. Marker-guarded, silent on failure.
 */
import prisma from "@/lib/db-raw";
import { ClientType, Platform } from "@prisma/client";

const MARKER_KEY = "valos_purged_from_gershon";
const MARKER_VERSION = "1";

/** LinkedIn vanities of VALOS's competitors and partner. */
const VALOS_VANITIES = new Set([
  "quanticate", "phastar", "veramed", "cytel",
  "statistics-%26-data-corporation", "statistics-&-data-corporation",
  "everest-clinical-research-services-inc-", "bioforum-ltd",
  "ephicacy-lifescience-analytics", "prometrika-llc", "rho-inc-", "bio4dreams",
]);
const VALOS_NAMES = new Set([
  "quanticate", "phastar", "veramed", "cytel", "statistics & data corporation (sdc)",
  "statistics & data corporation", "sdc", "everest clinical research", "bioforum",
  "ephicacy", "prometrika", "rho inc.", "rho", "bio4dreams",
]);
const REMOVABLE: ClientType[] = [ClientType.COMPETITION, ClientType.PARTNER];

let doneInThisIsolate = false;

function vanity(url: string | null | undefined): string | null {
  const m = (url || "").match(/linkedin\.com\/(?:company|in|school)\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

export type PurgeResult = { companies: string[]; posts: number; connections: number; settings: number; mirrors: number };

export async function purgeValosFromGershon(): Promise<PurgeResult | null> {
  const primary = await prisma.organization.findFirst({ where: { isPrimary: true } });
  if (!primary) return null;
  const orgId = primary.id;

  const conns = await prisma.platformConnection.findMany({
    where: { organizationId: orgId, platform: Platform.LINKEDIN },
    select: { clientId: true, externalAccountUrl: true },
  });
  const valosIds = conns
    .filter((c) => ["valos-srl", "76359943"].includes(vanity(c.externalAccountUrl) ?? ""))
    .map((c) => c.clientId);

  const candidates = new Set<string>();
  for (const c of conns) if (VALOS_VANITIES.has(vanity(c.externalAccountUrl) ?? "")) candidates.add(c.clientId);
  for (const vId of valosIds) {
    const row = await prisma.orgSetting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: `competitors:${vId}` } },
    });
    try { for (const id of (row ? (JSON.parse(row.value) as string[]) : [])) candidates.add(id); } catch { /* ignore */ }
  }
  const byName = await prisma.client.findMany({
    where: { organizationId: orgId, clientType: { in: REMOVABLE } },
    select: { id: true, name: true },
  });
  for (const c of byName) if (VALOS_NAMES.has(c.name.trim().toLowerCase())) candidates.add(c.id);
  for (const v of valosIds) candidates.delete(v);

  // Safety: only COMPETITION / PARTNER rows that really are in the primary workspace.
  const targets = await prisma.client.findMany({
    where: { id: { in: Array.from(candidates) }, organizationId: orgId, clientType: { in: REMOVABLE } },
    select: { id: true, name: true },
  });
  const ids = targets.map((t) => t.id);

  let posts = 0;
  let connections = 0;
  if (ids.length) {
    const mine = { clientId: { in: ids } };
    await prisma.dailyCompliance.deleteMany({ where: mine });
    await prisma.followerSnapshot.deleteMany({ where: mine });
    posts = (await prisma.socialPost.deleteMany({ where: mine })).count;
    await prisma.postingSchedule.deleteMany({ where: mine });
    await prisma.contentAnalysis.deleteMany({ where: mine });
    await prisma.postPrompt.deleteMany({ where: mine });
    await prisma.syncJob.deleteMany({ where: mine });
    connections = (await prisma.platformConnection.deleteMany({ where: mine })).count;
    await prisma.client.deleteMany({ where: { id: { in: ids }, organizationId: orgId } });
  }

  const keyed = [...valosIds, ...ids];
  const settings = keyed.length
    ? (await prisma.orgSetting.deleteMany({
        where: {
          organizationId: orgId,
          OR: keyed.flatMap((id) => [{ key: `competitors:${id}` }, { key: { startsWith: `competitor-brief:${id}` } }]),
        },
      })).count
    : 0;

  // Copying between workspaces is off for good: drop every mirror link.
  const mirrors = (await prisma.orgSetting.deleteMany({ where: { key: { startsWith: "mirror:" } } })).count;

  return { companies: targets.map((t) => t.name), posts, connections, settings, mirrors };
}

export async function purgeValosFromGershonOnce(): Promise<void> {
  if (doneInThisIsolate) return;
  try {
    const marker = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
    if (marker && (JSON.parse(marker.value) as { version?: string }).version === MARKER_VERSION) {
      doneInThisIsolate = true;
      return;
    }
    const r = await purgeValosFromGershon();
    if (!r) return;
    const value = JSON.stringify({ version: MARKER_VERSION, ...r, at: new Date().toISOString() });
    await prisma.setting.upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value }, update: { value } });
    doneInThisIsolate = true;
  } catch {
    // Retried on the next request.
  }
}

/** Status for verification (no secrets, primary-admin only route). */
export async function purgeStatus(): Promise<unknown> {
  const m = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
  return m ? JSON.parse(m.value) : null;
}
