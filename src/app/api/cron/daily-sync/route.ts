export const runtime = 'edge';
/**
 * Daily sync orchestrator.
 *
 * Runs in this order:
 *   1. runDailySync — legacy server-side post fetch (uses adapter registry +
 *      stored cookies/tokens). Best-effort: kept around because some
 *      platforms (Google Business, etc.) still go through it.
 *   2. Compliance recompute for all active clients.
 *   3. Phantombuster fallback — if any mandatory LINKEDIN/TWITTER
 *      PlatformConnection has lastSyncAt > 22h old (meaning the Chrome
 *      extension v0.10.0+ didn't refresh it yesterday), launch the
 *      Phantombuster phantoms to backfill.
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
import {
  runPhantombusterSync,
  findStaleConnections,
} from "@/lib/jobs/phantombuster-sync";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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

  // 3. Phantombuster fallback. Only fires when at least one mandatory
  //    LinkedIn/X connection didn't get refreshed in the last 22 hours —
  //    meaning the extension didn't run (Chrome was closed, etc.).
  try {
    const stale = await findStaleConnections();
    report.fallback.staleBefore = stale.length;
    if (stale.length === 0) {
      report.fallback.reason = "all LinkedIn/X connections refreshed in the last 22h";
    } else {
      report.fallback.reason = `${stale.length} stale connection(s) detected — launching Phantombuster`;
      const out = await runPhantombusterSync();
      report.fallback.ran = true;
      report.fallback.results = out.results;
      if (!out.ok) report.fallback.error = out.error;
    }
  } catch (e) {
    report.fallback.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(report);
}
