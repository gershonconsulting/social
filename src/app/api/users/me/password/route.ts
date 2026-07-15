export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import prisma from "@/lib/db";
import bcrypt from "bcryptjs";

/**
 * PATCH /api/users/me/password
 *
 * Self-serve password change. The signed-in user supplies their current
 * password (proof of identity) + a new password (≥ 12 chars). Server
 * verifies the current against the stored hash, then writes the new
 * bcrypt hash. New password is never logged.
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const email = (session?.user as { email?: string } | undefined)?.email;
    if (!email) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }
    const body = (await req.json().catch(() => null)) as
      | { currentPassword?: string; newPassword?: string }
      | null;
    if (!body?.currentPassword || !body?.newPassword) {
      return NextResponse.json({ success: false, error: "currentPassword + newPassword required" }, { status: 400 });
    }
    if (body.newPassword.length < 12) {
      return NextResponse.json({ success: false, error: "newPassword must be at least 12 characters" }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }
    // LinkedIn-only users have no password to compare against — they sign in
    // via "Continue with LinkedIn" and have no password to change.
    if (!user.password) {
      return NextResponse.json(
        {
          success: false,
          error: "This account signs in with LinkedIn and has no password to change.",
        },
        { status: 400 },
      );
    }
    const ok = await bcrypt.compare(body.currentPassword, user.password);
    if (!ok) {
      return NextResponse.json({ success: false, error: "Current password is incorrect" }, { status: 403 });
    }
    const hashed = await bcrypt.hash(body.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
