/**
 * Take VALOS's companies OUT of the Gershon workspace — and keep them out.
 *
 * Olivier, 2026-10-04: "Imagine a bank showing the data from another client's
 * account!"  Olivier, 2026-10-07: "I see competition of Valos in my account.
 * What happened? Fix this."
 *
 * History: v4.27.0 (marker version "1") deleted VALOS's competitors from the
 * Gershon workspace once. But Competitor Watch was still open on VALOS's
 * Gershon page, so the companies could be — and were — added back afterwards,
 * and a one-shot never looks again.
 *
 * v4.35.0 (marker version "2"):
 *   - Competitor Watch now exists only on a workspace's OWN (INTERNAL) company,
 *     so a client's competitors can no longer land in Gershon's Competition list.
 *   - This clean-up runs again. Each VALOS competitor / partner found in the
 *     Gershon workspace is MOVED to the VALOS workspace, not deleted:
 *       · if the VALOS workspace already has that company (same LinkedIn page),
 *         its posts are merged into that copy (duplicates skipped), then the
 *         Gershon row is removed;
 *       · otherwise the whole company (row, links, posts, history) is
 *         re-homed into the VALOS workspace and added to VALOS's Competitor
 *         Watch there.
 *   - VALOS itself stays in Gershon: it is a Gershon CAMPAIGN client.
 *   - Only COMPETITION / PARTNER rows are ever touched; Gershon's own
 *     competitors (on Gershon's INTERNAL company's watch list) never are.
 *
 * Marker-guarded, silent on failure, retried on the next page load.
 */
import prisma from "@/lib/db-raw";
import { ClientType, Platform } from "@prisma/client";

const MARKER_KEY = "valos_purged_from_gershon";
const MARKER_VERSION = "2";
const DMITRI_EMAIL = "dmitri.petratchenko@valos.it";

/** LinkedIn vanities of VALOS's competitors and partner. */
const VALOS_VANITIES = new Set([
  "quanticate", "phastar", "veramed", "cytel",
  "statistics-%26-data-corporation", "statistics-&-data-corporation",
  "everest-clinical-research-services-inc-", "bioforum-ltd",
  "ephicacy-lifescience-analytics", "prometrika-llc", "rho-inc-", "rho-inc", "bio4dreams",
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

function parseIds(v: string | null | undefined): string[] {
  try {
    const a = v ? JSON.parse(v) : [];
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type PurgeResult = {
  moved: string[];
  merged: string[];
  postsMerged: number;
  settings: number;
  valosWorkspace: string | null;
};

export async function purgeValosFromGershon(): Promise<PurgeResult | null> {
  const primary = await prisma.organization.findFirst({ where: { isPrimary: true } });
  if (!primary) return null;
  const orgId = primary.id;

  // VALOS workspace (Dmitri's). Required: we move, we never just drop data.
  const dmitri = await prisma.user.findFirst({
    where: { email: { equals: DMITRI_EMAIL, mode: "insensitive" } },
    select: { organizationId: true },
  });
  const valosOrg = dmitri?.organizationId
    ? await prisma.organization.findUnique({ where: { id: dmitri.organizationId } })
    : null;
  if (!valosOrg || valosOrg.isPrimary) return null; // not ready — retry later

  const conns = await prisma.platformConnection.findMany({
    where: { organizationId: orgId, platform: Platform.LINKEDIN },
    select: { clientId: true, externalAccountUrl: true },
  });
  const valosIds = conns
    .filter((c) => ["valos-srl", "76359943"].includes(vanity(c.externalAccountUrl) ?? ""))
    .map((c) => c.clientId);

  // Gershon's own competitors: on the watch list of a Gershon INTERNAL company. Never touched.
  const internal = await prisma.client.findMany({
    where: { organizationId: orgId, clientType: ClientType.INTERNAL },
    select: { id: true, name: true },
  });
  const protectedIds = new Set<string>();
  for (const c of internal) {
    const row = await prisma.orgSetting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: `competitors:${c.id}` } },
    });
    for (const id of parseIds(row?.value)) protectedIds.add(id);
  }

  const candidates = new Set<string>();
  for (const c of conns) if (VALOS_VANITIES.has(vanity(c.externalAccountUrl) ?? "")) candidates.add(c.clientId);
  for (const vId of valosIds) {
    const row = await prisma.orgSetting.findUnique({
      where: { organizationId_key: { organizationId: orgId, key: `competitors:${vId}` } },
    });
    for (const id of parseIds(row?.value)) candidates.add(id);
  }
  const typed = await prisma.client.findMany({
    where: { organizationId: orgId, clientType: { in: REMOVABLE } },
    select: { id: true, name: true, notes: true },
  });
  for (const c of typed) {
    if (VALOS_NAMES.has(c.name.trim().toLowerCase())) candidates.add(c.id);
    if (/competitor of valos/i.test(c.notes ?? "")) candidates.add(c.id);
  }
  for (const v of valosIds) candidates.delete(v);
  for (const p of protectedIds) candidates.delete(p);

  const targets = await prisma.client.findMany({
    where: { id: { in: Array.from(candidates) }, organizationId: orgId, clientType: { in: REMOVABLE } },
    select: {
      id: true, name: true, clientType: true,
      platformConnections: { select: { id: true, platform: true, externalAccountUrl: true } },
    },
  });

  // Where each one lives in the VALOS workspace, if it does.
  const valosConns = await prisma.platformConnection.findMany({
    where: { organizationId: valosOrg.id },
    select: { id: true, clientId: true, platform: true, externalAccountUrl: true },
  });
  const valosByVanity = new Map<string, string>();
  for (const c of valosConns) {
    const v = c.platform === Platform.LINKEDIN ? vanity(c.externalAccountUrl) : null;
    if (v) valosByVanity.set(v, c.clientId);
  }
  const valosCompany = valosConns.find((c) =>
    c.platform === Platform.LINKEDIN && ["valos-srl", "76359943"].includes(vanity(c.externalAccountUrl) ?? ""),
  )?.clientId ?? null;

  const moved: string[] = [];
  const merged: string[] = [];
  let postsMerged = 0;
  const newlyTracked: string[] = [];

  for (const t of targets) {
    const li = t.platformConnections.find((p) => p.platform === Platform.LINKEDIN);
    const v = vanity(li?.externalAccountUrl);
    const dest = (v && valosByVanity.get(v)) || null;

    if (dest) {
      // Merge posts into the VALOS workspace's own copy, platform by platform.
      for (const src of t.platformConnections) {
        const destConn = valosConns.find((c) => c.clientId === dest && c.platform === src.platform);
        if (!destConn) continue;
        postsMerged += await prisma.$executeRaw`
          UPDATE social_posts p
             SET "clientId" = ${dest}, "platformConnectionId" = ${destConn.id}, "organizationId" = ${valosOrg.id}
           WHERE p."clientId" = ${t.id} AND p."platformConnectionId" = ${src.id}
             AND NOT EXISTS (
               SELECT 1 FROM social_posts q
                WHERE q."clientId" = ${dest} AND q.platform = p.platform AND q."externalPostId" = p."externalPostId")`;
      }
      const mine = { clientId: t.id };
      await prisma.dailyCompliance.deleteMany({ where: mine });
      await prisma.followerSnapshot.deleteMany({ where: mine });
      await prisma.socialPost.deleteMany({ where: mine }); // only duplicates are left
      await prisma.postingSchedule.deleteMany({ where: mine });
      await prisma.contentAnalysis.deleteMany({ where: mine });
      await prisma.postPrompt.deleteMany({ where: mine });
      await prisma.syncJob.deleteMany({ where: mine });
      await prisma.platformConnection.deleteMany({ where: mine });
      await prisma.client.deleteMany({ where: { id: t.id, organizationId: orgId } });
      merged.push(t.name);
    } else {
      // Re-home the whole company into the VALOS workspace.
      const to = { organizationId: valosOrg.id };
      const mine = { clientId: t.id };
      await prisma.platformConnection.updateMany({ where: mine, data: to });
      await prisma.socialPost.updateMany({ where: mine, data: to });
      await prisma.dailyCompliance.updateMany({ where: mine, data: to });
      await prisma.followerSnapshot.updateMany({ where: mine, data: to });
      await prisma.postingSchedule.updateMany({ where: mine, data: to });
      await prisma.contentAnalysis.updateMany({ where: mine, data: to });
      await prisma.postPrompt.updateMany({ where: mine, data: to });
      await prisma.syncJob.updateMany({ where: mine, data: to });
      await prisma.client.update({ where: { id: t.id }, data: to });
      if (t.clientType === ClientType.COMPETITION) newlyTracked.push(t.id);
      moved.push(t.name);
    }
  }

  // Moved competitors show up in VALOS's Competitor Watch in its own workspace.
  if (valosCompany && newlyTracked.length) {
    const key = `competitors:${valosCompany}`;
    const row = await prisma.orgSetting.findUnique({
      where: { organizationId_key: { organizationId: valosOrg.id, key } },
    });
    const value = JSON.stringify(Array.from(new Set([...parseIds(row?.value), ...newlyTracked])).slice(0, 25));
    await prisma.orgSetting.upsert({
      where: { organizationId_key: { organizationId: valosOrg.id, key } },
      create: { organizationId: valosOrg.id, key, value },
      update: { value },
    });
  }

  // Competitor Watch on a Gershon company that isn't Gershon's own: links + briefs go.
  const keepWatch = new Set(internal.map((c) => c.id));
  const watchRows = await prisma.orgSetting.findMany({
    where: { organizationId: orgId, OR: [{ key: { startsWith: "competitors:" } }, { key: { startsWith: "competitor-brief:" } }] },
    select: { id: true, key: true },
  });
  const drop = watchRows.filter((r) => !keepWatch.has(r.key.split(":")[1] ?? "")).map((r) => r.id);
  const settings = drop.length ? (await prisma.orgSetting.deleteMany({ where: { id: { in: drop } } })).count : 0;

  return { moved, merged, postsMerged, settings, valosWorkspace: valosOrg.name };
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

/** Status for verification (no secrets). */
export async function purgeStatus(): Promise<unknown> {
  const m = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
  return m ? JSON.parse(m.value) : null;
}
