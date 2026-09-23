export const runtime = 'edge';
/**
 * Acting on one person.
 *
 * Raw client, hand-written ownership checks — same reason as the list route:
 * the operator of the primary workspace must be able to act on signups that
 * have no workspace yet, which is exactly what automatic scoping cannot see.
 * Everyone else can only touch their own organization. See admin-scope.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { adminScopeFor, mayAdminister } from "@/lib/admin-scope";
import { createOrganizationFor } from "@/lib/tenancy";

const patchSchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
  // Drop the password so the account is LinkedIn-only. Refused unless that
  // account has already signed in with LinkedIn at least once, so this can
  // never lock anybody out.
  removePassword: z.literal(true).optional(),
  // Let a self-registered account in (approve) or keep it out (reject).
  // Approving clears pendingApproval and activates; rejecting just deactivates
  // and leaves the row, so the same person can't silently re-register.
  approve: z.boolean().optional(),
});

function authErr(e: unknown): NextResponse | null {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Admins only" }, { status: 403 });
  return null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole(UserRole.ADMIN);
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Auth error" }, { status: 500 });
  }
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed" }, { status: 400 });
  }

  const scope = await adminScopeFor(actor);
  const target = await prisma.user.findUnique({ where: { id } });
  // "Not found" rather than "forbidden": somebody in another workspace is not
  // a person this admin gets to learn the existence of.
  if (!target || !mayAdminister(scope, target)) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  // Guard: never let the last active admin be demoted or disabled
  // (self-lockout) — counted within that person's own workspace, since every
  // workspace needs one of its own.
  const removingAdminPower =
    (parsed.data.role && parsed.data.role !== UserRole.ADMIN && target.role === UserRole.ADMIN) ||
    ((parsed.data.isActive === false || parsed.data.approve === false) &&
      target.role === UserRole.ADMIN);
  if (removingAdminPower) {
    const activeAdmins = await prisma.user.count({
      where: { role: UserRole.ADMIN, isActive: true, organizationId: target.organizationId },
    });
    if (activeAdmins <= 1) {
      return NextResponse.json(
        { success: false, error: "Can't remove the last active admin." },
        { status: 400 },
      );
    }
  }

  const { removePassword, approve, ...fields } = parsed.data;

  // Approval decision on a self-registered account.
  //
  // Approving is what creates their workspace: sign-up deliberately leaves a
  // pending account without one, so that turning somebody down doesn't strand
  // an empty organization. They become the admin of that workspace and of
  // nothing else — every query they can make is confined to it.
  let approvalData: Record<string, unknown> = {};
  if (approve === true) {
    const workspace =
      target.organizationId
        ? null
        : await createOrganizationFor(target.name || target.email);
    approvalData = {
      pendingApproval: false,
      isActive: true,
      approvedAt: new Date(),
      approvedById: actor.id ?? null,
      ...(workspace ? { organizationId: workspace.id, role: UserRole.ADMIN } : {}),
    };
  } else if (approve === false) {
    approvalData = {
      pendingApproval: false,
      isActive: false,
      approvedAt: null,
      approvedById: actor.id ?? null,
    };
  }

  if (removePassword) {
    if (!target.linkedinSub) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This account hasn't signed in with LinkedIn yet. Removing its password would lock it out.",
        },
        { status: 400 },
      );
    }
    if (!target.password) {
      return NextResponse.json(
        { success: false, error: "This account already has no password." },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...fields,
      ...approvalData,
      ...(removePassword ? { password: null } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      pendingApproval: true,
      organizationId: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: updated.organizationId ?? scope.orgId,
      actorUserId: actor.id ?? null,
      actionType: "USER_UPDATED",
      entityType: "User",
      entityId: id,
      afterJson: JSON.stringify(parsed.data),
    },
  });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole(UserRole.ADMIN);
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Auth error" }, { status: 500 });
  }
  const { id } = await ctx.params;

  const scope = await adminScopeFor(actor);
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || !mayAdminister(scope, target)) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  if (target.role === UserRole.ADMIN) {
    const activeAdmins = await prisma.user.count({
      where: { role: UserRole.ADMIN, isActive: true, organizationId: target.organizationId },
    });
    if (activeAdmins <= 1) {
      return NextResponse.json({ success: false, error: "Can't delete the last active admin." }, { status: 400 });
    }
  }

  await prisma.user.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      organizationId: target.organizationId ?? scope.orgId,
      actorUserId: actor.id ?? null,
      actionType: "USER_UPDATED",
      entityType: "User",
      entityId: id,
      afterJson: JSON.stringify({ deleted: true, email: target.email }),
    },
  });

  return NextResponse.json({ success: true });
}
