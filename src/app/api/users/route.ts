export const runtime = 'edge';
/**
 * The people in a workspace.
 *
 * Reads and writes go through the RAW client with the organization filter
 * written out by hand, because this route needs something the automatic
 * scoping deliberately cannot express: the operator of the primary workspace
 * also sees accounts that have signed up and are waiting for a decision.
 * Those have no organization yet, so nobody else could ever approve them.
 * See admin-scope.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { adminScopeFor, visibleUsersWhere } from "@/lib/admin-scope";

// Invite: password is optional. LinkedIn-only users are invited by email +
// role and sign in with "Continue with LinkedIn".
const createUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).optional(),
  role: z.nativeEnum(UserRole).default(UserRole.OPERATIONS),
});

function authErr(e: unknown): NextResponse | null {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Admins only" }, { status: 403 });
  return null;
}

export async function GET(_req: NextRequest) {
  let actor;
  try {
    actor = await requireRole(UserRole.ADMIN);
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Auth error" }, { status: 500 });
  }

  const scope = await adminScopeFor(actor);

  const users = await prisma.user.findMany({
    where: visibleUsersWhere(scope),
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      linkedinSub: true, password: true, image: true, createdAt: true,
      // v3.9.0 — everything we know about who this person is.
      pendingApproval: true, approvedAt: true,
      givenName: true, familyName: true, locale: true, emailVerified: true,
      signupSource: true, signupIp: true, signupCountry: true, signupUserAgent: true,
      lastLoginAt: true, lastLoginIp: true, loginCount: true,
    },
    // Anyone waiting on a decision floats to the top.
    orderBy: [{ pendingApproval: "desc" }, { createdAt: "desc" }],
  });

  // Never expose the LinkedIn sub or the password hash — only whether each exists.
  const data = users.map(({ linkedinSub, password, ...u }) => ({
    ...u,
    linkedinLinked: !!linkedinSub,
    hasPassword: !!password,
  }));
  return NextResponse.json({ success: true, data });
}

export async function POST(req: NextRequest) {
  let actor;
  try {
    actor = await requireRole(UserRole.ADMIN);
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Auth error" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const scope = await adminScopeFor(actor);
  if (!scope.orgId) {
    return NextResponse.json(
      { success: false, error: "Your account isn't attached to a workspace yet." },
      { status: 409 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ success: false, error: "Email already registered" }, { status: 409 });
  }

  const password = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : null;
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email,
      password,
      role: parsed.data.role,
      // An invitation is into the inviting admin's workspace, never a new one.
      organizationId: scope.orgId,
      signupSource: "invite",
      approvedAt: new Date(),
    },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: scope.orgId,
      actorUserId: actor.id ?? null,
      actionType: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      afterJson: JSON.stringify({
        name: user.name,
        email: user.email,
        role: user.role,
        invited: !password,
        organizationId: scope.orgId,
      }),
    },
  });

  return NextResponse.json({ success: true, data: user }, { status: 201 });
}
