export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/auth/linkedin/callback?code=xxx&state=yyy
 *
 * Handles the OAuth 2.0 callback from LinkedIn. Exchanges the authorization code
 * for an access token and stores it in the PlatformConnection.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";

  if (error) {
    const desc = request.nextUrl.searchParams.get("error_description") || error;
    return NextResponse.redirect(
      `${appUrl}/admin?error=${encodeURIComponent(desc)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${appUrl}/admin?error=${encodeURIComponent("Missing code or state parameter")}`
    );
  }

  let clientId: string;
  let connectionId: string;
  try {
    const parsed = JSON.parse(atob(state));
    clientId = parsed.clientId;
    connectionId = parsed.connectionId;
  } catch {
    return NextResponse.redirect(
      `${appUrl}/admin?error=${encodeURIComponent("Invalid state parameter")}`
    );
  }

  const linkedinClientId = process.env.LINKEDIN_CLIENT_ID;
  const linkedinClientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = `${appUrl}/api/auth/linkedin/callback`;

  if (!linkedinClientId || !linkedinClientSecret) {
    return NextResponse.redirect(
      `${appUrl}/admin?error=${encodeURIComponent("LinkedIn OAuth not configured")}`
    );
  }

  try {
    // Exchange code for access token
    const tokenResp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: linkedinClientId,
        client_secret: linkedinClientSecret,
      }),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      return NextResponse.redirect(
        `${appUrl}/clients/${clientId}?error=${encodeURIComponent("Token exchange failed: " + errBody.slice(0, 100))}`
      );
    }

    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 5184000; // Default 60 days

    // Update PlatformConnection with the new token
    await prisma.platformConnection.update({
      where: { id: connectionId },
      data: {
        tokenReference: accessToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        connectionStatus: "CONNECTED",
        lastSyncError: null,
      },
    });

    // Redirect back to client page with success message
    return NextResponse.redirect(
      `${appUrl}/clients/${clientId}?connected=linkedin`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${appUrl}/clients/${clientId}?error=${encodeURIComponent("OAuth error: " + message.slice(0, 100))}`
    );
  }
}
