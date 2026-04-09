#!/usr/bin/env node
/**
 * Standalone job runner — executes scheduled sync jobs.
 * Run with: npx tsx src/jobs/runner.ts [job-type]
 *
 * Job types:
 *   daily-sync        — sync posts + follower snapshots for all active clients
 *   compliance        — recompute compliance for last 2 days
 *   token-health      — check all platform tokens
 *
 * Schedule via cron (example):
 *   0 6 * * *   npx tsx src/jobs/runner.ts daily-sync
 *   0 7 * * *   npx tsx src/jobs/runner.ts compliance
 *   0 5 * * *   npx tsx src/jobs/runner.ts token-health
 */

import prisma from "../lib/db";
import { runDailySync } from "../lib/jobs/sync";
import { recomputeClientCompliance } from "../lib/compliance/engine";
import { getAdapter } from "../lib/adapters/registry";
import { ClientStatus, ConnectionStatus } from "@prisma/client";
import { subDays } from "date-fns";

const jobType = process.argv[2] ?? "daily-sync";

async function runDailyJob() {
  console.log(`[${new Date().toISOString()}] Starting daily sync job…`);
  await runDailySync(null);
  console.log("Daily sync complete.");
}

async function runComplianceJob() {
  console.log(`[${new Date().toISOString()}] Starting compliance recompute…`);

  const clients = await prisma.client.findMany({
    where: { status: ClientStatus.ACTIVE },
  });

  for (const client of clients) {
    const since = subDays(new Date(), 2);
    const until = new Date();
    await recomputeClientCompliance(client.id, since, until);
    console.log(`  Recomputed: ${client.name}`);
  }

  console.log("Compliance recompute complete.");
}

async function runTokenHealthCheck() {
  console.log(`[${new Date().toISOString()}] Starting token health check…`);

  const connections = await prisma.platformConnection.findMany({
    where: { isEnabled: true },
    include: { client: true },
  });

  for (const conn of connections) {
    const adapter = getAdapter(conn.platform);
    if (!adapter) continue;

    const config = {
      platform: conn.platform,
      clientId: conn.clientId,
      connectionId: conn.id,
      externalAccountId: conn.externalAccountId ?? "",
      tokenReference: conn.tokenReference,
      timezone: conn.client.timezone,
    };

    const result = await adapter.validateConnection(config);

    const newStatus = result.valid ? ConnectionStatus.CONNECTED : ConnectionStatus.ERROR;
    if (conn.connectionStatus !== newStatus) {
      await prisma.platformConnection.update({
        where: { id: conn.id },
        data: {
          connectionStatus: newStatus,
          lastSyncError: result.valid ? null : result.error,
        },
      });
      console.log(
        `  ${conn.client.name}/${conn.platform}: ${conn.connectionStatus} → ${newStatus}${!result.valid ? ` (${result.error})` : ""}`
      );
    }
  }

  console.log("Token health check complete.");
}

async function main() {
  try {
    switch (jobType) {
      case "daily-sync":
        await runDailyJob();
        break;
      case "compliance":
        await runComplianceJob();
        break;
      case "token-health":
        await runTokenHealthCheck();
        break;
      default:
        console.error(`Unknown job type: ${jobType}`);
        process.exit(1);
    }
  } catch (err) {
    console.error("Job failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
