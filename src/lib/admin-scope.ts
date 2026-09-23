/**
 * Who an admin is allowed to administer.
 *
 * "Admin" means two different things now and conflating them is a leak.
 *
 *   Admin of a workspace — every tenant has one, usually the person who signed
 *   up. They manage their own people and nobody else's. The Users screen must
 *   show them their organization and stop there.
 *
 *   Admin of the primary workspace (Gershon Consulting) — the operator of the
 *   platform. They additionally see accounts that have signed up and are
 *   waiting for a decision, because a pending signup has no workspace yet and
 *   so there is nobody else who could possibly approve it.
 *
 * That second capability is the ONLY cross-organization read in the app, it is
 * limited to rows with pendingApproval = true, and it is why the user routes
 * talk to the raw client and filter by hand instead of leaning on db.ts.
 */
import prisma from "@/lib/db-raw";
import { getPrimaryOrganization } from "@/lib/tenancy";

export type AdminScope = {
  /** The workspace this admin manages. Null only in a broken/legacy state. */
  orgId: string | null;
  /** True when they run the primary workspace, i.e. they operate the platform. */
  isPlatformAdmin: boolean;
};

export async function adminScopeFor(actor: {
  id?: string;
  organizationId?: string;
}): Promise<AdminScope> {
  let orgId = actor.organizationId ?? null;

  // Sessions minted before tenancy shipped don't carry it.
  if (!orgId && actor.id) {
    const row = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { organizationId: true },
    });
    orgId = row?.organizationId ?? null;
  }

  const primary = await getPrimaryOrganization();
  return { orgId, isPlatformAdmin: !!orgId && !!primary && orgId === primary.id };
}

/**
 * The `where` an admin may read users through: their own workspace, plus —
 * for the platform operator only — everyone still waiting for a decision.
 */
export function visibleUsersWhere(scope: AdminScope) {
  if (scope.isPlatformAdmin) {
    return { OR: [{ organizationId: scope.orgId }, { pendingApproval: true }] };
  }
  return { organizationId: scope.orgId };
}

/** Whether this admin may act on a particular user row. */
export function mayAdminister(
  scope: AdminScope,
  target: { organizationId: string | null; pendingApproval: boolean },
): boolean {
  if (target.organizationId && target.organizationId === scope.orgId) return true;
  return scope.isPlatformAdmin && target.pendingApproval;
}
