export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";

const patchSchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
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

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });

  // Guard: never let the last active admin be demoted or disabled (self-lockout).
  const removingAdminPower =
    (parsed.data.role && parsed.data.role !== UserRole.ADMIN && target.role === UserRole.ADMIN) ||
    (parsed.data.isActive === false && target.role === UserRole.ADMIN);
  if (removingAdminPower) {
    const activeAdmins = await prisma.user.count({ where: { role: UserRole.ADMIN, isActive: true } });
    if (activeAdmins <= 1) {
      return NextResponse.json(
        { success: false, error: "Can't remove the last active admin." },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: parsed.data,
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  await prisma.auditLog.create({
    data: {
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

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });

  if (target.role === UserRole.ADMIN) {
    const activeAdmins = await prisma.user.count({ where: { role: UserRole.ADMIN, isActive: true } });
    if (activeAdmins <= 1) {
      return NextResponse.json({ success: false, error: "Can't delete the last active admin." }, { status: 400 });
    }
  }

  await prisma.user.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id ?? null,
      actionType: "USER_UPDATED",
      entityType: "User",
      entityId: id,
      afterJson: JSON.stringify({ deleted: true, email: target.email }),
    },
  });

  return NextResponse.json({ success: true });
}
