export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent(error || "No authorization code received")}`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent("Google OAuth credentials not configured")}`
    );
  }

  try {
    // Exchange code for tokens
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResp.ok) {
      const errData = await tokenResp.text();
      console.error("Google token exchange failed:", errData);
      return NextResponse.redirect(
        `${appUrl}/settings?error=${encodeURIComponent("Failed to exchange authorization code")}`
      );
    }

    const tokens = await tokenResp.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Get user email for display
    let email = "Google Account";
    try {
      const userResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userResp.ok) {
        const userData = await userResp.json();
        email = userData.email || email;
      }
    } catch {
      // Non-critical, continue
    }

    // Store token on all Google Business platform connections
    const tokenRef = JSON.stringify({
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: expiresAt.toISOString(),
    });

    const googleConnections = await prisma.platformConnection.findMany({
      where: { platform: "GOOGLE_BUSINESS" },
    });

    if (googleConnections.length === 0) {
      // No existing connections — update will happen when clients are added
      return NextResponse.redirect(
        `${appUrl}/settings?success=google&note=${encodeURIComponent("Authenticated but no Google Business connections found. Add a client with Google Business first.")}`
      );
    }

    for (const conn of googleConnections) {
      await prisma.platformConnection.update({
        where: { id: conn.id },
        data: {
          tokenReference: tokenRef,
          tokenExpiresAt: expiresAt,
          connectionStatus: "CONNECTED",
          externalAccountName: email,
        },
      });
    }

    return NextResponse.redirect(`${appUrl}/settings?success=google`);
  } catch (err) {
    console.error("Google OAuth error:", err);
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent("OAuth flow failed")}`
    );
  }
}
