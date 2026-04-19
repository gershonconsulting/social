export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * POST /api/platforms/[id]/discover-location
 * 
 * Discovers Google Business Profile accounts and locations
 * using the stored OAuth token. Returns found locations so
 * the correct one can be set as externalAccountId.
 */

const GBP_ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const GBP_LOCATIONS_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const GBP_V4_API = "https://mybusiness.googleapis.com/v4";

interface AccountResult {
  name: string;
  accountName?: string;
  type?: string;
}

interface LocationResult {
  name: string;          // e.g. "locations/123456"
  title?: string;        // Business name
  storefrontAddress?: { locality?: string; regionCode?: string };
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
  try {
    if (connection.tokenReference) {
      // Token may be stored as JSON { accessToken, refreshToken, ... } or as plain string
      if (connection.tokenReference.startsWith("{")) {
        const parsed = JSON.parse(connection.tokenReference);
        accessToken = parsed.accessToken || parsed.access_token || null;
      } else {
        accessToken = connection.tokenReference;
      }
    }
  } catch {
    return NextResponse.json({ success: false, error: "Failed to parse stored token" }, { status: 500 });
  }

  if (!accessToken) {
    return NextResponse.json({ success: false, error: "No access token available. Please reconnect Google." }, { status: 400 });
  }

  const headers = { Authorization: `Bearer ${accessToken}` };
  const diagnostics: Record<string, unknown> = {};

  // Step 1: Try the new Account Management API
  let accounts: AccountResult[] = [];
  try {
    const accountsRes = await fetch(`${GBP_ACCOUNTS_API}/accounts`, { headers });
    diagnostics.accountsApiStatus = accountsRes.status;
    
    if (accountsRes.ok) {
      const data = await accountsRes.json();
      accounts = (data.accounts || []) as AccountResult[];
      diagnostics.accountsFound = accounts.length;
      diagnostics.accounts = accounts.map((a: AccountResult) => ({
        name: a.name,
        accountName: a.accountName,
        type: a.type,
      }));
    } else {
      const errBody = await accountsRes.text().catch(() => "");
      diagnostics.accountsApiError = errBody.slice(0, 500);
    }
  } catch (err) {
    diagnostics.accountsApiError = err instanceof Error ? err.message : String(err);
  }

  // Step 2: Try the old v4 accounts API as fallback
  if (accounts.length === 0) {
    try {
      const v4AccountsRes = await fetch(`${GBP_V4_API}/accounts`, { headers });
      diagnostics.v4AccountsApiStatus = v4AccountsRes.status;
      
      if (v4AccountsRes.ok) {
        const data = await v4AccountsRes.json();
        accounts = (data.accounts || []) as AccountResult[];
        diagnostics.v4AccountsFound = accounts.length;
        diagnostics.v4Accounts = accounts.map((a: AccountResult) => ({
          name: a.name,
          accountName: a.accountName,
          type: a.type,
        }));
      } else {
        const errBody = await v4AccountsRes.text().catch(() => "");
        diagnostics.v4AccountsApiError = errBody.slice(0, 500);
      }
    } catch (err) {
      diagnostics.v4AccountsApiError = err instanceof Error ? err.message : String(err);
    }
  }

  // Step 3: For each account, list locations
  const allLocations: Array<{ accountName: string; locationName: string; title: string; address?: string }> = [];

  for (const account of accounts) {
    // Try new Business Information API
    try {
      const locRes = await fetch(
        `${GBP_LOCATIONS_API}/${account.name}/locations?readMask=name,title,storefrontAddress`,
        { headers }
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

        // Fallback: try v4 locations API
        const v4LocRes = await fetch(`${GBP_V4_API}/${account.name}/locations`, { headers });
        diagnostics[`v4_locations_${account.name}_status`] = v4LocRes.status;
        if (v4LocRes.ok) {
          const v4LocData = await v4LocRes.json();
          for (const loc of (v4LocData.locations || []) as LocationResult[]) {
            allLocations.push({
              accountName: account.name,
              locationName: loc.name,
              title: loc.title || "Unknown",
              address: loc.storefrontAddress?.locality || undefined,
            });
          }
        } else {
          const v4Err = await v4LocRes.text().catch(() => "");
          diagnostics[`v4_locations_${account.name}_error`] = v4Err.slice(0, 500);
        }
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
      ? "No locations found. Token may be expired or account has no locations."
      : `Found ${allLocations.length} locations. Use PATCH /api/platforms/${id} to set externalAccountId.`,
    locations: allLocations,
    diagnostics,
  });
}
