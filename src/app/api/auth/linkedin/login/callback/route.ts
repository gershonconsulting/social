export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import {
  appUrl,
  legacyLoginRedirectUri,
  mintSessionToken,
  sessionCookieName,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/linkedin-auth";
import { completeLinkedInLogin, readRequestContext } from "@/lib/linkedin-login-flow";

/**
 * GET /api/auth/linkedin/login/callback
 *
 * The original sign-in callback. LinkedIn currently rejects this URL
 * ("redirect_uri does not match the registered value") because only
 * /api/auth/linkedin/callback is authorized on the app, so live traffic now
 * goes there instead. This route is kept — identical behaviour, its own
 * redirect URI — so that registering this URL in the portal later is a
 * one-line change in linkedin-auth.ts and nothing else.
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
    const outcome = await completeLinkedInLogin(code, legacyLoginRedirectUri(), readRequestContext(req));
    if (!outcome.ok) {
      return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(outcome.error)}`);
    }

    const jwt = await mintSessionToken(outcome.user);
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
