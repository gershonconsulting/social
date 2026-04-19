export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/linkedin/connect?clientId=xxx&connectionId=yyy
 *
 * Initiates LinkedIn OAuth 2.0 flow. Redirects the user to LinkedIn's
 * authorization page. On success, LinkedIn redirects back to /api/auth/linkedin/callback.
 *
 * Required env vars: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, NEXT_PUBLIC_APP_URL
 */
export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get("clientId");
  const connectionId = request.nextUrl.searchParams.get("connectionId");

  if (!clientId || !connectionId) {
    return NextResponse.json(
      { error: "clientId and connectionId are required" },
      { status: 400 }
    );
  }

  const linkedinClientId = process.env.LINKEDIN_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";

  if (!linkedinClientId) {
    return NextResponse.json(
      { error: "LINKEDIN_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  const redirectUri = `${appUrl}/api/auth/linkedin/callback`;
  const state = btoa(JSON.stringify({ clientId, connectionId }));

  const scopes = [
    "r_organization_social",
    "r_1st_connections_size",
    "rw_organization_admin",
    "w_member_social",
  ].join(" ");

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", linkedinClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", scopes);

  return NextResponse.redirect(authUrl.toString());
}
