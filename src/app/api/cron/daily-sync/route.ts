export const runtime = 'edge';
/**
 * Cron endpoint for daily sync.
 *
 * Called by Cloudflare Cron Triggers or an external cron service.
 * Protect with a secret key stored in CRON_SECRET environment variable.
 *
 * Example cron-job.org setup:
 *   URL: https://social.gershoncrm.com/api/cron/daily-sync
 *   Header: Authorization: Bearer <CRON_SECRET>
 *   Schedule: 0 6 * * *   (6am UTC daily)
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

  try {
    // 1. Sync posts
    await runDailySync(null);

    // 2. Recompute compliance for all active clients
    const clients = await prisma.client.findMany({
      where: { status: ClientStatus.ACTIVE },
    });

    for (const client of clients) {
      await recomputeClientCompliance(
        client.id,
        subDays(new Date(), 2),
        new Date()
      );
    }

    return NextResponse.json({
      success: true,
      message: "Daily sync complete",
      clients: clients.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Cron job failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
