/**
 * The client-CONNECTION half of /api/auth/linkedin/callback (as opposed to
 * sign-in). Split out of the route in v4.26.1 and loaded with a dynamic
 * import, so a sign-in through the same URL never evaluates Prisma.
 * Uses the normal tenant-scoped client — unchanged behaviour.
 */
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function finishLinkedInConnect(
  code: string,
  parsedState: { mode?: string; clientId?: string; connectionId?: string },
  appUrl: string,
): Promise<NextResponse> {
  const clientId = parsedState.clientId || "";
  const connectionId = parsedState.connectionId || "";

  const linkedinClientId = process.env.LINKEDIN_CLIENT_ID;
  const linkedinClientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = `${appUrl}/api/auth/linkedin/callback`;

  if (!linkedinClientId || !linkedinClientSecret) {
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent("LinkedIn OAuth not configured")}`
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
        `${appUrl}/settings?error=${encodeURIComponent("Token exchange failed: " + errBody.slice(0, 100))}`
      );
    }

    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in || 5184000; // Default 60 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    if (connectionId) {
      // Update a specific connection
      await prisma.platformConnection.update({
        where: { id: connectionId },
        data: {
          tokenReference: accessToken,
          tokenExpiresAt: expiresAt,
          connectionStatus: "CONNECTED",
          lastSyncError: null,
        },
      });
    } else {
      // Update ALL LinkedIn platform connections (settings page flow)
      await prisma.platformConnection.updateMany({
        where: { platform: "LINKEDIN" },
        data: {
          tokenReference: accessToken,
          tokenExpiresAt: expiresAt,
          connectionStatus: "CONNECTED",
          lastSyncError: null,
        },
      });
    }

    // Verify the newly-issued token actually works before declaring CONNECTED.
    // LinkedIn issues tokens even for unapproved apps and for users who are not
    // org admins; the API then rejects every actual call with 401/403. Without
    // this probe, the user sees a green 'Connected' status next to platforms
    // that can never read a single post.
    try {
      const probe = await fetch("https://api.linkedin.com/v2/me", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "LinkedIn-Version": "202401",
        },
      });
      if (!probe.ok) {
        let detail = "";
        try {
          const body = await probe.text();
          try {
            const j = JSON.parse(body);
            const msg = (j as { message?: string }).message;
            detail = msg ?? body.slice(0, 200);
          } catch {
            detail = body.slice(0, 200);
          }
        } catch {}
        const newStatus = probe.status === 401 ? "EXPIRED" : "ERROR";
        const newErr = `LinkedIn token verification returned ${probe.status}${detail ? `: ${detail}` : ""}`;
        if (connectionId) {
          await prisma.platformConnection.update({
            where: { id: connectionId },
            data: { connectionStatus: newStatus, lastSyncError: newErr },
          });
        } else {
          await prisma.platformConnection.updateMany({
            where: { platform: "LINKEDIN" },
            data: { connectionStatus: newStatus, lastSyncError: newErr },
          });
        }
      }
    } catch {
      // Verification network error is non-fatal — leave CONNECTED, the next sync will diagnose
    }

    // Redirect back to settings with success
    const redirectTo = clientId
      ? `${appUrl}/clients/${clientId}?connected=linkedin`
      : `${appUrl}/settings?success=linkedin`;

    return NextResponse.redirect(redirectTo);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${appUrl}/settings?error=${encodeURIComponent("OAuth error: " + message.slice(0, 100))}`
    );
  }
}
