export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { appUrl, loginRedirectUri, LOGIN_SCOPES } from "@/lib/linkedin-auth";

/**
 * GET /api/auth/linkedin/login
 *
 * Starts the "Sign In with LinkedIn" flow. Sets a random state cookie (CSRF)
 * and redirects to LinkedIn's OIDC authorization page. LinkedIn returns to
 * /api/auth/linkedin/login/callback.
 */
export async function GET(_req: NextRequest) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      `${appUrl()}/login?error=${encodeURIComponent("LinkedIn sign-in not configured (LINKEDIN_CLIENT_ID missing).")}`,
    );
  }

  const state = crypto.randomUUID();
  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", loginRedirectUri());
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", LOGIN_SCOPES);

  const res = NextResponse.redirect(authUrl.toString());
  res.cookies.set("li_login_state", state, {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min
  });
  return res;
}
