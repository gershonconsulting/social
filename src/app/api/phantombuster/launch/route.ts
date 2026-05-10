export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { getPbConfig, launchPhantom, fetchAgentSavedArgument } from "@/lib/phantombuster";
import prisma from "@/lib/db";

/**
 * POST /api/phantombuster/launch
 * Body (optional): { clientId?: string }
 *
 * Launches both configured Phantoms (Twitter + LinkedIn) in parallel.
 *
 * If `clientId` is provided, fetches that client's per-platform connection
 * URLs (TWITTER + LINKEDIN externalAccountUrl) and overrides the phantom's
 * saved `spreadsheetUrl` argument so the phantom runs against THAT client's
 * profile, not the default one baked into the phantom config. The saved
 * sessionCookie / userAgent / etc. are preserved (we merge on top).
 *
 * If no clientId is supplied, the phantoms run with whatever default
 * arguments are saved in the PB UI (used by the daily cron).
 */
function linkedinActivityUrl(profileUrl: string): string {
  // Phantom's LinkedIn Activity Extractor expects the activity feed URL.
  // For company pages: append /posts/?feedView=all&viewAsMember=true
  // For profile pages: append /recent-activity/all/
  // Idempotent: if it's already a /posts/ or /recent-activity/ URL, leave it.
  let u = profileUrl.trim().replace(/\/+$/, "");
  if (/\/posts(\/|$|\?)/.test(u) || /\/recent-activity\//.test(u)) return profileUrl;
  if (/\/company\//.test(u)) return `${u}/posts/?feedView=all&viewAsMember=true`;
  if (/\/in\//.test(u)) return `${u}/recent-activity/all/`;
  return profileUrl;
}

export async function POST(req: NextRequest) {
  try {
    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, error: "Phantombuster is not configured. Add the API key in /settings." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null) as { clientId?: string } | null;
    const clientId = body?.clientId;

    // Look up per-platform target URLs for this client (if any).
    let twitterUrl: string | null = null;
    let linkedinUrl: string | null = null;
    let clientLabel: string | null = null;
    if (clientId) {
      const conns = await prisma.platformConnection.findMany({
        where: { clientId, platform: { in: [Platform.TWITTER, Platform.LINKEDIN] }, isEnabled: true },
        select: { platform: true, externalAccountUrl: true },
      });
      const c = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
      clientLabel = c?.name ?? clientId;
      for (const conn of conns) {
        if (conn.platform === Platform.TWITTER) twitterUrl = conn.externalAccountUrl ?? null;
        if (conn.platform === Platform.LINKEDIN) linkedinUrl = conn.externalAccountUrl ?? null;
      }
    }

    const launches: Array<{ platform: string; phantomId: string | null; containerId: string | null; targetUrl?: string | null; error?: string }> = [];
    const targets: Array<[Platform, string | null, string | null]> = [
      [Platform.TWITTER, config.twitterPhantomId, twitterUrl],
      [Platform.LINKEDIN, config.linkedinPhantomId, linkedinUrl ? linkedinActivityUrl(linkedinUrl) : null],
    ];

    await Promise.all(
      targets.map(async ([platform, phantomId, perClientUrl]) => {
        const entry: typeof launches[number] = { platform: String(platform), phantomId, containerId: null, targetUrl: perClientUrl };
        if (!phantomId) {
          entry.error = "No Phantom ID configured for this platform.";
          launches.push(entry);
          return;
        }
        // Build the argument override. We need to preserve the saved
        // sessionCookie + other phantom-specific fields, so fetch the saved
        // argument first and merge on top.
        let argumentOverride: Record<string, unknown> | undefined = undefined;
        if (perClientUrl) {
          const saved = await fetchAgentSavedArgument(config.apiKey, phantomId);
          argumentOverride = { ...saved, spreadsheetUrl: perClientUrl };
        }
        const r = await launchPhantom(config.apiKey, phantomId, argumentOverride);
        if (!r.containerId) {
          entry.error = `Launch failed (HTTP ${r.rawStatus})${r.bodyHead ? `: ${r.bodyHead}` : ""}`;
        } else {
          entry.containerId = r.containerId;
        }
        launches.push(entry);
      })
    );
    return NextResponse.json({ success: true, data: { launches, clientLabel } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Launch failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
