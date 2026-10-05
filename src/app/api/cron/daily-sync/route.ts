export const runtime = 'edge';
/**
 * Daily sync orchestrator.
 *
 * Runs in this order:
 *   1. runDailySync — legacy server-side post fetch (uses adapter registry +
 *      stored cookies/tokens). Best-effort: kept around because some
 *      platforms (Google Business, etc.) still go through it.
 *   2. Compliance recompute for all active clients.
 *   3. (Phantombuster fallback — retired in v4.29.0.)
 *
 * The Chrome extension daily auto-sync (v0.10.0) is the primary data path —
 * runs inside the user's logged-in browser at their real residential IP, so
 * LinkedIn/X can't tell it from manual browsing. Phantombuster is the
 * fallback that kicks in when Chrome was closed all day.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> header required when CRON_SECRET
 * is set in the environment.
 */

import { NextRequest, NextResponse } from "next/server";
import { runDailySync } from "@/lib/jobs/sync";
import prisma from "@/lib/db";
import { recomputeClientCompliance } from "@/lib/compliance/engine";
import { ClientStatus } from "@prisma/client";
import { subDays } from "date-fns";
import { isolateDmitri } from "@/lib/workspaces/empty-workspace";
import { seedValosWorkspace } from "@/lib/workspaces/seed-valos";
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Backstop for the one-shot in the dashboard layout: make sure Dmitri's
  // workspace is emptied even if nobody has opened the dashboard. Runs before
  // mirror-sync so no copied posts land first. Marker-guarded, never throws.
  await isolateDmitri();
  await seedValosWorkspace();

  const report: {
    success: boolean;
    legacySync: { ran: boolean; error?: string };
    compliance: { clients: number; error?: string };
    fallback: {
      ran: boolean;
      reason: string;
      staleBefore: number;
      results?: unknown;
      error?: string;
    };
    timestamp: string;
  } = {
    success: true,
    legacySync: { ran: false },
    compliance: { clients: 0 },
    fallback: { ran: false, reason: "", staleBefore: 0 },
    timestamp: new Date().toISOString(),
  };

  // 1. Legacy server-side post fetch (covers non-LinkedIn/X platforms).
  try {
    await runDailySync(null);
    report.legacySync.ran = true;
  } catch (e) {
    report.legacySync.error = e instanceof Error ? e.message : String(e);
  }

  // 2. Compliance recompute for active clients.
  try {
    const clients = await prisma.client.findMany({
      where: { status: ClientStatus.ACTIVE },
    });
    for (const client of clients) {
      try {
        await recomputeClientCompliance(client.id, subDays(new Date(), 2), new Date());
      } catch {}
    }
    report.compliance.clients = clients.length;
  } catch (e) {
    report.compliance.error = e instanceof Error ? e.message : String(e);
  }

  // v4.29.0: Phantombuster retired. Both PB phantoms (Twitter Media
  // Extractor, LinkedIn Activity Extractor) were deleted from the PB account
  // on 2026-08-18, so this step had produced 0 posts every day since. The
  // Chrome extension is the collection path; nothing calls PB any more.
  report.fallback.reason = "Phantombuster retired (v4.29.0) — not called";

  // Mirrored companies in other workspaces pick up what was just collected.
  // Separate same-origin request = its own Worker budget. Best-effort.
  try {
    const url = new URL(req.url);
    if (secret) {
      await fetch(`${url.protocol}//${url.host}/api/cron/mirror-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
    }
  } catch {}

  return NextResponse.json(report);
}
