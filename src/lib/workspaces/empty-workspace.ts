/**
 * Emptying a workspace, and the one-shot that empties Dmitri's.
 *
 * Olivier, 2026-10-02: "Dmitri still has MY companies. It should be empty."
 * A new tenant starts from scratch — their own clients, partners, competition
 * and internal accounts, none of Gershon's. Dmitri Petratchenko (VALOS) was
 * the first outside signup and was handed Gershon data twice over: first he
 * sat in the PRIMARY workspace, then mirrored copies of VALOS + its
 * competitors were the plan for his own. Both are wrong now. His workspace is
 * emptied and he goes through /welcome like any other new tenant.
 *
 * SAFETY. Every delete is pinned to ONE organizationId that has been checked
 * to be a non-primary workspace. Gershon's own rows — including the source
 * companies any mirror was copied from — are never touched. Only copies go.
 *
 * Kept: the Organization row, its users, the extension token and the X/LinkedIn
 * session settings (those are the tenant's own, not Gershon's). Removed: every
 * company and everything hanging off one, plus the mirror / competitor links
 * and the onboarding dismissal, so the getting-started checklist shows again.
 */
import prisma from "@/lib/db-raw";
import { createOrganizationFor } from "@/lib/tenancy";

const DMITRI_EMAIL = "dmitri.petratchenko@valos.it";
const DMITRI_WORKSPACE = "VALOS";
const MARKER_KEY = "dmitri_workspace_emptied";
const MARKER_VERSION = "1";

/** Company-related OrgSetting keys. Credentials and the token are NOT here. */
const COMPANY_SETTING_PREFIXES = ["mirror:", "competitors:", "competitor-brief:"];
const RESET_SETTING_KEYS = ["onboarding_dismissed"];

let doneInThisIsolate = false;

export type EmptyResult = {
  clients: number;
  connections: number;
  posts: number;
  settings: number;
};

/** Delete every company (and its children) in one NON-primary workspace. */
export async function emptyWorkspace(orgId: string): Promise<EmptyResult> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error("WORKSPACE_NOT_FOUND");
  if (org.isPrimary) throw new Error("REFUSED_PRIMARY_WORKSPACE");

  const clients = await prisma.client.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const clientIds = clients.map((c) => c.id);
  // A child row belongs to this workspace if it is stamped with it OR hangs
  // off one of its companies — either is enough to remove it.
  const mine = clientIds.length
    ? { OR: [{ organizationId: orgId }, { clientId: { in: clientIds } }] }
    : { organizationId: orgId };

  // Children before parents.
  await prisma.dailyCompliance.deleteMany({ where: mine });
  await prisma.followerSnapshot.deleteMany({ where: mine });
  const posts = await prisma.socialPost.deleteMany({ where: mine });
  await prisma.postingSchedule.deleteMany({ where: mine });
  await prisma.contentAnalysis.deleteMany({ where: mine });
  await prisma.postPrompt.deleteMany({ where: mine });
  await prisma.syncJob.deleteMany({ where: mine });
  const connections = await prisma.platformConnection.deleteMany({ where: mine });
  const removedClients = await prisma.client.deleteMany({ where: { organizationId: orgId } });

  const settings = await prisma.orgSetting.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        ...COMPANY_SETTING_PREFIXES.map((p) => ({ key: { startsWith: p } })),
        { key: { in: RESET_SETTING_KEYS } },
      ],
    },
  });

  return {
    clients: removedClients.count,
    connections: connections.count,
    posts: posts.count,
    settings: settings.count,
  };
}

/**
 * One-shot: make sure Dmitri is in his OWN workspace and that it is empty.
 * Marker-guarded, idempotent, and silent on failure — housekeeping must never
 * take a page render down.
 */
export async function isolateDmitri(): Promise<void> {
  if (doneInThisIsolate) return;

  try {
    const marker = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
    if (marker) {
      const parsed = JSON.parse(marker.value) as { version?: string };
      if (parsed.version === MARKER_VERSION) {
        doneInThisIsolate = true;
        return;
      }
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: DMITRI_EMAIL, mode: "insensitive" } },
      select: { id: true, organizationId: true },
    });
    if (!user) {
      // Nothing to do yet; don't write the marker so it runs if he appears.
      doneInThisIsolate = true;
      return;
    }

    const primary = await prisma.organization.findFirst({ where: { isPrimary: true } });
    let orgId = user.organizationId;
    let moved = false;

    if (!orgId || orgId === primary?.id) {
      // Still in Gershon's workspace: give him his own. Reuse a VALOS
      // workspace if an earlier attempt created one.
      const existing = await prisma.organization.findFirst({
        where: { name: DMITRI_WORKSPACE, isPrimary: false },
      });
      orgId = existing?.id ?? (await createOrganizationFor(DMITRI_WORKSPACE)).id;
      // Admin of his own workspace, exactly like any self-signup (v4.4.0).
      await prisma.user.update({
        where: { id: user.id },
        data: { organizationId: orgId, role: "ADMIN", pendingApproval: false },
      });
      moved = true;
    }

    const result = await emptyWorkspace(orgId);
    const value = JSON.stringify({
      version: MARKER_VERSION,
      userId: user.id,
      orgId,
      movedOutOfPrimary: moved,
      ...result,
      at: new Date().toISOString(),
    });
    await prisma.setting.upsert({
      where: { key: MARKER_KEY },
      create: { key: MARKER_KEY, value },
      update: { value },
    });
    doneInThisIsolate = true;
  } catch {
    // Retried on the next request.
  }
}
