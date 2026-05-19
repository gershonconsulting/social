export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, Platform } from "@prisma/client";
import { syncSpreadsheet, PB_SPREADSHEET_ID } from "@/lib/google-sheets";

/**
 * POST /api/admin/sheets-sync
 *
 * Rebuilds the Phantombuster source spreadsheet from current DB state.
 * Tab 'LinkedIn' (gid=0):  Company Name, Website, Category, LinkedIn Link
 * Tab 'Twitter'  (gid=2068816684): Company Name, Website, Category, Twitter/X Link
 *
 * Called automatically when a new client is created (POST /api/clients),
 * and can be invoked manually from /admin/coverage to re-sync after manual
 * spreadsheet edits.
 *
 * Requires GOOGLE_SHEETS_SVC_JSON env var + the spreadsheet shared with
 * the service account's client_email as Editor.
 */

const CATEGORY_LABEL: Record<string, string> = {
  CLIENT: "Client",
  PROSPECT: "Prospect",
  PARTNER: "Partner",
  COMPETITION: "Competition",
  INTERNAL: "Internal",
};

export async function POST(req: NextRequest) {
  // Auth: same Bearer CRON_SECRET pattern, but also allow no-auth same-origin calls.
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (auth) {
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const clients = await prisma.client.findMany({
      where: { status: ClientStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: {
        name: true,
        website: true,
        clientType: true,
        platformConnections: {
          where: { isEnabled: true, platform: { in: [Platform.LINKEDIN, Platform.TWITTER] } },
          select: { platform: true, externalAccountUrl: true },
        },
      },
    });

    const linkedinRows: string[][] = [["Company Name", "Website", "Category", "LinkedIn Link"]];
    const twitterRows: string[][] = [["Company Name", "Website", "Category", "Twitter/X Link"]];

    for (const c of clients) {
      const li = c.platformConnections.find((p) => p.platform === Platform.LINKEDIN);
      const tw = c.platformConnections.find((p) => p.platform === Platform.TWITTER);
      const cat = CATEGORY_LABEL[c.clientType] ?? c.clientType;
      const website = c.website ?? "";
      if (li?.externalAccountUrl) {
        // Phantombuster's spreadsheet uses bare-host LinkedIn URLs (no scheme).
        const url = li.externalAccountUrl.replace(/^https?:\/\/(?:www\.)?/i, "");
        linkedinRows.push([c.name, website, cat, url]);
      }
      if (tw?.externalAccountUrl) {
        const url = tw.externalAccountUrl.replace(/^https?:\/\/(?:www\.)?/i, "");
        twitterRows.push([c.name, website, cat, url]);
      }
    }

    const out = await syncSpreadsheet(PB_SPREADSHEET_ID, [
      { name: "LinkedIn", range: "LinkedIn!A:D", rows: linkedinRows },
      { name: "Twitter",  range: "Twitter!A:D",  rows: twitterRows  },
    ]);
    if (!out.ok) {
      return NextResponse.json({ success: false, error: out.error }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      data: {
        linkedinClients: linkedinRows.length - 1,
        twitterClients: twitterRows.length - 1,
        perTab: out.perTab,
        spreadsheet: `https://docs.google.com/spreadsheets/d/${PB_SPREADSHEET_ID}/edit`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sheets-sync failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
