export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * POST /api/platforms/[id]/discover-location
 * 
 * Discovers Google Business Profile accounts and locations.
 * Auto-refreshes the OAuth token if expired, then lists accounts/locations.
 */

const GBP_ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const GBP_LOCATIONS_API = "https://mybusinessbusinessinformation.googleapis.com/v1";

interface AccountResult {
  name: string;
  accountName?: string;
  type?: string;
}

interface LocationResult {
  name: string;
  title?: string;
  storefrontAddress?: { locality?: string; regionCode?: string };
}

/**
 * Refresh a Google OAuth access token using the refresh token.
 */
async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: string;
} | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) return null;

  const data = await resp.json();
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  return { accessToken: data.access_token, expiresAt };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const connection = await prisma.platformConnection.findUnique({
    where: { id },
  });

  if (!connection) {
    return NextResponse.json({ success: false, error: "Connection not found" }, { status: 404 });
  }

  if (connection.platform !== "GOOGLE_BUSINESS") {
    return NextResponse.json({ success: false, error: "Not a Google Business connection" }, { status: 400 });
  }

  // Parse the stored token
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let tokenExpired = false;

  try {
    if (connection.tokenReference) {
      if (connection.tokenReference.startsWith("{")) {
        const parsed = JSON.parse(connection.tokenReference);
        accessToken = parsed.accessToken || parsed.access_token || null;
        refreshToken = parsed.refreshToken || parsed.refresh_token || null;
        if (parsed.expiresAt) {
          tokenExpired = new Date(parsed.expiresAt) < new Date();
        }
      } else {
        accessToken = connection.tokenReference;
      }
    }
  } catch {
    return NextResponse.json({ success: false, error: "Failed to parse stored token" }, { status: 500 });
  }

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ success: false, error: "No token available. Please reconnect Google via Settings." }, { status: 400 });
  }

  const diagnostics: Record<string, unknown> = {
    tokenExpired,
    hasRefreshToken: !!refreshToken,
  };

  // Step 0: If token expired and we have a refresh token, refresh it
  if ((tokenExpired || !accessToken) && refreshToken) {
    diagnostics.attemptingRefresh = true;
    const refreshed = await refreshAccessToken(refreshToken);
    
    if (refreshed) {
      accessToken = refreshed.accessToken;
      diagnostics.tokenRefreshed = true;

      // Update the stored token in DB
      const newTokenRef = JSON.stringify({
        accessToken: refreshed.accessToken,
        refreshToken,
        expiresAt: refreshed.expiresAt,
      });

      await prisma.platformConnection.update({
        where: { id },
        data: {
          tokenReference: newTokenRef,
          tokenExpiresAt: new Date(refreshed.expiresAt),
          lastSyncError: null,
        },
      });
    } else {
      diagnostics.refreshFailed = true;
      return NextResponse.json({
        success: false,
        error: "Token expired and refresh failed. Please reconnect Google via Settings.",
        diagnostics,
      });
    }
  }

  const headers = { Authorization: `Bearer ${accessToken}` };

  // Step 1: List accounts via Account Management API
  let accounts: AccountResult[] = [];
  try {
    const accountsRes = await fetch(`${GBP_ACCOUNTS_API}/accounts`, { headers });
    diagnostics.accountsApiStatus = accountsRes.status;

    if (accountsRes.status === 401) {
      // Token actually expired — try refresh even if we thought it was valid
      if (refreshToken) {
        const refreshed = await refreshAccessToken(refreshToken);
        if (refreshed) {
          accessToken = refreshed.accessToken;
          const retryHeaders = { Authorization: `Bearer ${accessToken}` };
          
          // Update DB
          const newTokenRef = JSON.stringify({
            accessToken: refreshed.accessToken,
            refreshToken,
            expiresAt: refreshed.expiresAt,
          });
          await prisma.platformConnection.update({
            where: { id },
            data: {
              tokenReference: newTokenRef,
              tokenExpiresAt: new Date(refreshed.expiresAt),
            },
          });

          // Retry
          const retryRes = await fetch(`${GBP_ACCOUNTS_API}/accounts`, { headers: retryHeaders });
          diagnostics.retryAccountsStatus = retryRes.status;
          if (retryRes.ok) {
            const data = await retryRes.json();
            accounts = (data.accounts || []) as AccountResult[];
          } else {
            const errBody = await retryRes.text().catch(() => "");
            diagnostics.retryAccountsError = errBody.slice(0, 500);
          }
        } else {
          return NextResponse.json({
            success: false,
            error: "Token expired and refresh failed. Please reconnect Google via Settings.",
            diagnostics,
          });
        }
      } else {
        return NextResponse.json({
          success: false,
          error: "Token expired and no refresh token available. Please reconnect Google via Settings.",
          diagnostics,
        });
      }
    } else if (accountsRes.ok) {
      const data = await accountsRes.json();
      accounts = (data.accounts || []) as AccountResult[];
    } else {
      const errBody = await accountsRes.text().catch(() => "");
      diagnostics.accountsApiError = errBody.slice(0, 500);
    }
  } catch (err) {
    diagnostics.accountsApiError = err instanceof Error ? err.message : String(err);
  }

  diagnostics.accountsFound = accounts.length;
  diagnostics.accounts = accounts.map((a) => ({
    name: a.name,
    accountName: a.accountName,
    type: a.type,
  }));

  // Step 2: For each account, list locations
  const allLocations: Array<{ accountName: string; locationName: string; title: string; address?: string }> = [];

  for (const account of accounts) {
    const currentHeaders = { Authorization: `Bearer ${accessToken}` };
    try {
      const locRes = await fetch(
        `${GBP_LOCATIONS_API}/${account.name}/locations?readMask=name,title,storefrontAddress`,
        { headers: currentHeaders }
      );
      diagnostics[`locations_${account.name}_status`] = locRes.status;

      if (locRes.ok) {
        const locData = await locRes.json();
        for (const loc of (locData.locations || []) as LocationResult[]) {
          allLocations.push({
            accountName: account.name,
            locationName: loc.name,
            title: loc.title || "Unknown",
            address: loc.storefrontAddress?.locality || undefined,
          });
        }
      } else {
        const errBody = await locRes.text().catch(() => "");
        diagnostics[`locations_${account.name}_error`] = errBody.slice(0, 500);
      }
    } catch (err) {
      diagnostics[`locations_${account.name}_error`] = err instanceof Error ? err.message : String(err);
    }
  }

  diagnostics.totalLocationsFound = allLocations.length;

  // If exactly one location found, auto-set it
  if (allLocations.length === 1) {
    const loc = allLocations[0];
    const fullLocationName = loc.locationName.startsWith("accounts/")
      ? loc.locationName
      : `${loc.accountName}/${loc.locationName}`;

    await prisma.platformConnection.update({
      where: { id },
      data: {
        externalAccountId: fullLocationName,
        externalAccountName: loc.title,
        connectionStatus: "CONNECTED",
        lastSyncError: null,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Auto-configured location: ${loc.title}`,
      location: { name: fullLocationName, title: loc.title },
      diagnostics,
    });
  }

  return NextResponse.json({
    success: allLocations.length > 0,
    message: allLocations.length === 0
      ? "No locations found. Token may be invalid or account has no Business Profile locations."
      : `Found ${allLocations.length} locations. Use PATCH /api/platforms/${id} to set externalAccountId.`,
    locations: allLocations,
    diagnostics,
  });
}
