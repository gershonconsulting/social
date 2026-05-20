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

  // Daily PB import: fetch whatever CSV PB has produced since the last
  // import + upsert. Does NOT launch a new PB run — PB runs on its own
  // schedule on PB's side. This keeps us inside the worker time budget
  // while still getting fresh data daily even when the Chrome extension
  // hasn't run.
  try {
    const url = new URL(req.url);
    const r = await fetch(`${url.protocol}//${url.host}/api/cron/pb-import-latest`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (r.ok) {
      const j = await r.json() as { data?: { perPlatform?: Array<{ platform: string; postsUpserted: number }> } };
      report.fallback.ran = true;
      report.fallback.results = j.data?.perPlatform;
      const total = (j.data?.perPlatform ?? []).reduce((s, p) => s + (p.postsUpserted ?? 0), 0);
      report.fallback.reason = `PB import: ${total} posts upserted`;
    } else {
      report.fallback.error = `pb-import-latest HTTP ${r.status}`;
      report.fallback.reason = "PB import attempted but failed";
    }
  } catch (e) {
    report.fallback.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(report);
}
