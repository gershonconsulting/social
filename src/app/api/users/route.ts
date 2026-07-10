export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";

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
  try {
    await requireRole(UserRole.ADMIN);
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Auth error" }, { status: 500 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      linkedinSub: true, image: true, createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  // Expose whether a user can sign in with LinkedIn (linked) — not the sub itself.
  const data = users.map(({ linkedinSub, ...u }) => ({ ...u, linkedinLinked: !!linkedinSub }));
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

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ success: false, error: "Email already registered" }, { status: 409 });
  }

  const password = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : null;
  const user = await prisma.user.create({
    data: { name: parsed.data.name, email, password, role: parsed.data.role },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: actor.id ?? null,
      actionType: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      afterJson: JSON.stringify({ name: user.name, email: user.email, role: user.role, invited: !password }),
    },
  });

  return NextResponse.json({ success: true, data: user }, { status: 201 });
}
