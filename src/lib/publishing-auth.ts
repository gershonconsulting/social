/**
 * Who is calling the /api/publishing routes, and for which workspace.
 * Reads need a signed-in member; writes need OPERATIONS or ADMIN.
 */
import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import prisma from "@/lib/db-raw";

export type PublishingCaller = { orgId: string; userId: string | null; name: string; canWrite: boolean };

export async function publishingCaller(write: boolean): Promise<PublishingCaller | NextResponse> {
  let user;
  try {
    user = await requireAuth();
  } catch {
    return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  }
  let orgId = user.organizationId ?? null;
  if (!orgId && user.id) {
    const u = await prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
    orgId = u?.organizationId ?? null;
  }
  if (!orgId) {
    return NextResponse.json({ success: false, error: "Your account isn't attached to a workspace yet." }, { status: 409 });
  }
  const canWrite = user.role === UserRole.ADMIN || user.role === UserRole.OPERATIONS;
  if (write && !canWrite) {
    return NextResponse.json({ success: false, error: "Read-only users can't change posts." }, { status: 403 });
  }
  return { orgId, userId: user.id ?? null, name: user.name || user.email || "", canWrite };
}
