export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { completeLinkedInLogin, readRequestContext } from "@/lib/linkedin-login-flow";
import {
  connectRedirectUri,
  mintSessionToken,
  sessionCookieName,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/linkedin-auth";

/**
 * Finishes the SIGN-IN flow, which comes back through this same URL because
 * the LinkedIn app has only one authorized redirect URL. Distinguished from a
 * client-connection callback by `state.mode === "login"`.
 */
async function finishSignIn(req: NextRequest, code: string, state: string): Promise<NextResponse> {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";
  const cookieState = req.cookies.get("li_login_state")?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(
      `${base}/login?error=${encodeURIComponent("Sign-in expired or invalid. Please try again.")}`,
    );
  }

  let outcome;
  try {
    outcome = await completeLinkedInLogin(code, connectRedirectUri(), readRequestContext(req));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LinkedIn sign-in failed";
    return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(msg.slice(0, 160))}`);
  }

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
}

/**
 * GET /api/auth/linkedin/callback?code=xxx&state=yyy
 *
 * Handles the OAuth 2.0 callback from LinkedIn. Exchanges the authorization code
 * for an access token and stores it in the PlatformConnection(s).
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";

  if (error) {
    const desc = request.nextUrl.searchParams.get("error_description") || error;
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent(desc)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent("Missing code or state parameter")}`
    );
  }

  let parsedState: { mode?: string; clientId?: string; connectionId?: string };
  try {
    parsedState = JSON.parse(atob(state));
  } catch {
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent("Invalid state parameter")}`
    );
  }

  // Sign-in comes back through this same URL — hand it off before any
  // PlatformConnection write happens.
  if (parsedState.mode === "login") {
    return finishSignIn(request, code, state);
  }

  // Client-connection flow. Loaded on demand so the sign-in path above never
  // evaluates Prisma: a cold Prisma engine on the edge blows the Worker CPU
  // budget and the callback answers Error 1102 (fixed v4.26.1).
  const { finishLinkedInConnect } = await import("@/lib/linkedin-connect-flow");
  return finishLinkedInConnect(code, parsedState, appUrl);
}
