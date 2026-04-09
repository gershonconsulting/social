/**
 * Cron endpoint for daily follower snapshot collection.
 * Schedule: 0 7 * * *  (7am UTC daily)
 */

import { NextRequest, NextResponse } from "next/server";
import { syncFollowerSnapshots } from "@/lib/jobs/sync";
import prisma from "@/lib/db";
import { ClientStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const clients = await prisma.client.findMany({
      where: { status: ClientStatus.ACTIVE },
    });

    for (const client of clients) {
      await syncFollowerSnapshots(client.id);
    }

    return NextResponse.json({
      success: true,
      message: "Follower snapshots collected",
      clients: clients.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
