export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { UserRole } from "@prisma/client";
import {
  appUrl,
  exchangeCode,
  fetchProfile,
  mintSessionToken,
  sessionCookieName,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/linkedin-auth";

/**
 * GET /api/auth/linkedin/login/callback
 *
 * Completes LinkedIn sign-in:
 *   1. verify state (CSRF)
 *   2. exchange code -> access token, read OIDC userinfo
 *   3. allow-list check:
 *        - match an active User by linkedinSub or email  -> sign in
 *        - else if this is the FIRST user (no ADMIN yet) -> bootstrap as ADMIN
 *        - else if email in ADMIN_LINKEDIN_EMAILS env    -> provision as ADMIN
 *        - else                                          -> deny (must be invited)
 *   4. mint the NextAuth session cookie and redirect to /dashboard
 */
export async function GET(req: NextRequest) {
  const base = appUrl();
  const url = req.nextUrl;
  const err = url.searchParams.get("error");
  if (err) {
    const desc = url.searchParams.get("error_description") || err;
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(desc)}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("li_login_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      `${base}/login?error=${encodeURIComponent("Sign-in expired or invalid. Please try again.")}`,
    );
  }

  try {
    const token = await exchangeCode(code);
    const profile = await fetchProfile(token);
    const email = (profile.email || "").toLowerCase().trim();
    if (!email) {
      return NextResponse.redirect(
        `${base}/login?error=${encodeURIComponent("LinkedIn did not share an email address. Grant email permission and retry.")}`,
      );
    }

    // 1) Existing user by linkedinSub, else by email.
    let user =
      (await prisma.user.findUnique({ where: { linkedinSub: profile.sub } })) ??
      (await prisma.user.findUnique({ where: { email } }));

    if (user && !user.isActive) {
      return NextResponse.redirect(
        `${base}/login?error=${encodeURIComponent("Your access has been disabled. Contact the account admin.")}`,
      );
    }

    if (!user) {
      // 2) Bootstrap: the very first person to sign in becomes ADMIN.
      const adminCount = await prisma.user.count({ where: { role: UserRole.ADMIN } });
      const adminEmails = (process.env.ADMIN_LINKEDIN_EMAILS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const shouldBeAdmin = adminCount === 0 || adminEmails.includes(email);

      if (!shouldBeAdmin) {
        // Not invited — deny.
        return NextResponse.redirect(
          `${base}/login?error=${encodeURIComponent("This LinkedIn account isn't invited yet. Ask the admin to add you.")}`,
        );
      }

      user = await prisma.user.create({
        data: {
          name: profile.name || email,
          email,
          linkedinSub: profile.sub,
          image: profile.picture ?? null,
          role: UserRole.ADMIN,
          isActive: true,
        },
      });
      await prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          actionType: "USER_CREATED",
          entityType: "User",
          entityId: user.id,
          afterJson: JSON.stringify({ email, role: "ADMIN", via: "linkedin-bootstrap" }),
        },
      });
    } else {
      // Keep the LinkedIn linkage + profile fresh on every login.
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          linkedinSub: profile.sub,
          name: user.name || profile.name || email,
          image: profile.picture ?? user.image,
        },
      });
    }

    const jwt = await mintSessionToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      image: user.image,
    });

    const res = NextResponse.redirect(`${base}/dashboard`);
    res.cookies.set(sessionCookieName(), jwt, {
      httpOnly: true,
      secure: base.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    res.cookies.set("li_login_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LinkedIn sign-in failed";
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(msg.slice(0, 160))}`);
  }
}
