export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { Platform } from "@prisma/client";
import { getPbConfig, launchPhantom } from "@/lib/phantombuster";

/**
 * POST /api/phantombuster/launch
 * Launches both configured Phantoms in parallel. Returns immediately with
 * the containerIds. Frontend then polls /api/phantombuster/check until
 * each one finishes, then calls /api/phantombuster/import to consume the
 * CSV. Splitting this way keeps each worker call well under Cloudflare's
 * time budget.
 */
export async function POST(_req: NextRequest) {
  try {
    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, error: "Phantombuster is not configured. Add the API key in /settings." },
        { status: 400 }
      );
    }
    const launches: Array<{ platform: string; phantomId: string | null; containerId: string | null; error?: string }> = [];
    const targets: Array<[Platform, string | null]> = [
      [Platform.TWITTER, config.twitterPhantomId],
      [Platform.LINKEDIN, config.linkedinPhantomId],
    ];
    await Promise.all(
      targets.map(async ([platform, phantomId]) => {
        const entry: typeof launches[number] = { platform: String(platform), phantomId, containerId: null };
        if (!phantomId) {
          entry.error = "No Phantom ID configured for this platform.";
          launches.push(entry);
          return;
        }
        const r = await launchPhantom(config.apiKey, phantomId);
        if (!r.containerId) {
          entry.error = `Launch failed (HTTP ${r.rawStatus})${r.bodyHead ? `: ${r.bodyHead}` : ""}`;
        } else {
          entry.containerId = r.containerId;
        }
        launches.push(entry);
      })
    );
    return NextResponse.json({ success: true, data: { launches } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Launch failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
