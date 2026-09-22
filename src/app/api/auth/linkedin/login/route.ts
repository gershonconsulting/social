export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { appUrl, loginRedirectUri, LOGIN_SCOPES } from "@/lib/linkedin-auth";

/**
 * GET /api/auth/linkedin/login
 *
 * Starts the "Sign In with LinkedIn" flow.
 *
 * The LinkedIn app has ONE authorized redirect URL —
 * /api/auth/linkedin/callback — so the sign-in flow returns through the same
 * URL the "connect a client page" flow uses. The state carries `mode: "login"`
 * so the callback knows which flow it is finishing, and a matching cookie
 * covers CSRF.
 */
export async function GET(_req: NextRequest) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      `${appUrl()}/login?error=${encodeURIComponent("LinkedIn sign-in not configured (LINKEDIN_CLIENT_ID missing).")}`,
    );
  }

  const nonce = crypto.randomUUID();
  const state = btoa(JSON.stringify({ mode: "login", nonce }));

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
