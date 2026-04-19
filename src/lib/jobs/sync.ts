/**
 * Post sync job — fetches posts from all configured platform adapters,
 * upserts them into the database, and triggers compliance recomputation.
 */

import prisma from "@/lib/db";
import { getAdapter } from "@/lib/adapters/registry";
import { GoogleBusinessAdapter } from "@/lib/adapters/google-business";
import { recomputeCompliance } from "@/lib/compliance/engine";
import { AdapterConfig } from "@/types";
import { Platform, SyncJobType, SyncStatus, ConnectionStatus } from "@prisma/client";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

export interface SyncOptions {
  clientId?: string;
  platformConnectionId?: string;
  since?: Date;
  until?: Date;
  triggeredById?: string | null;
  isBackfill?: boolean;
}

/**
 * Run a post sync for one platform connection.
 */
export async function syncPlatformConnection(
  connectionId: string,
  since: Date,
  until: Date,
  triggeredById: string | null = null
): Promise<{ success: boolean; error?: string; postsUpserted: number }> {
  const connection = await prisma.platformConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { client: true },
  });

  const adapter = getAdapter(connection.platform);

  if (!adapter) {
    await prisma.platformConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: "No adapter implemented for platform " + connection.platform,
      },
    });
    return {
      success: false,
      error: "No adapter for " + connection.platform,
      postsUpserted: 0,
    };
  }

  // Auto-discover platform-specific IDs if not set
  let externalAccountId = connection.externalAccountId ?? "";

  // Google Business: discover location ID
  if (connection.platform === "GOOGLE_BUSINESS" && !externalAccountId && connection.tokenReference) {
    const gbAdapter = adapter as GoogleBusinessAdapter;
    const location = await gbAdapter.discoverLocation(connection.tokenReference);
    if (location) {
      externalAccountId = location.locationName;
      await prisma.platformConnection.update({
        where: { id: connectionId },
        data: {
          externalAccountId: location.locationName,
          externalAccountName: location.displayName,
        },
      });
    }
  }

  // LinkedIn: discover organization ID from company URL
  if (connection.platform === "LINKEDIN" && !externalAccountId && connection.tokenReference) {
    const companyUrl = connection.externalAccountUrl || "";
    // Extract vanity name from URL like https://www.linkedin.com/company/gershonconsulting
    const vanityMatch = companyUrl.match(/linkedin\.com\/(?:company|in)\/([^\/?#]+)/i);
    if (vanityMatch) {
      const vanityName = vanityMatch[1];
      try {
        const orgResp = await fetch(
          `https://api.linkedin.com/v2/organizations?q=vanityName&vanityName=${encodeURIComponent(vanityName)}`,
          {
            headers: {
              "Authorization": `Bearer ${connection.tokenReference}`,
              "LinkedIn-Version": "202401",
              "X-Restli-Protocol-Version": "2.0.0",
            },
          }
        );
        if (orgResp.ok) {
          const orgData = await orgResp.json();
          const org = orgData.elements?.[0];
          if (org?.id) {
            externalAccountId = String(org.id);
            await prisma.platformConnection.update({
              where: { id: connectionId },
              data: {
                externalAccountId: String(org.id),
                externalAccountName: org.localizedName || vanityName,
              },
            });
          }
        }
      } catch (e) {
        // Org lookup failed, continue without it
        console.error("LinkedIn org lookup failed:", e);
      }
    }
  }

  // Twitter: extract user ID if we have credentials but no ID
  if (connection.platform === "TWITTER" && !externalAccountId && connection.tokenReference) {
    // Twitter credentials are stored as JSON {username, password} - can't use API without Bearer token
    // Skip Twitter sync until a Bearer token is configured
  }

  const config: AdapterConfig = {
    platform: connection.platform,
    clientId: connection.clientId,
    connectionId: connection.id,
    externalAccountId,
    tokenReference: connection.tokenReference,
    timezone: connection.client.timezone,
  };

  const result = await adapter.fetchPosts(config, since, until);

  // Update connection health
  if (result.error) {
    const isTokenError = ["TOKEN_EXPIRED", "PERMISSION_DENIED", "NO_TOKEN"].includes(
      result.errorCode ?? ""
    );

    await prisma.platformConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: result.error,
        connectionStatus: isTokenError ? ConnectionStatus.EXPIRED : ConnectionStatus.ERROR,
      },
    });

    return { success: false, error: result.error, postsUpserted: 0 };
  }

  // Upsert posts
  let postsUpserted = 0;
  for (const post of result.posts) {
    await prisma.socialPost.upsert({
      where: {
        clientId_platform_externalPostId: {
          clientId: connection.clientId,
          platform: connection.platform,
          externalPostId: post.externalPostId,
        },
      },
      create: {
        clientId: connection.clientId,
        platformConnectionId: connectionId,
        platform: connection.platform,
        externalPostId: post.externalPostId,
        postUrl: post.postUrl,
        postTextSnippet: post.postTextSnippet,
        hasMedia: post.hasMedia,
        publishedAtUtc: post.publishedAtUtc,
        publishedAtLocal: post.publishedAtLocal,
        publishedDateLocal: post.publishedDateLocal,
        likeCount: post.likeCount ?? 0,
        commentCount: post.commentCount ?? 0,
        shareCount: post.shareCount ?? 0,
        rawPayloadJson: JSON.stringify(post.rawPayload),
      },
      update: {
        postUrl: post.postUrl,
        postTextSnippet: post.postTextSnippet,
        hasMedia: post.hasMedia,
        likeCount: post.likeCount ?? 0,
        commentCount: post.commentCount ?? 0,
        shareCount: post.shareCount ?? 0,
        rawPayloadJson: JSON.stringify(post.rawPayload),
      },
    });
    postsUpserted++;
  }

  // Update connection status to connected
  await prisma.platformConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: null,
      connectionStatus: ConnectionStatus.CONNECTED,
    },
  });

  // Recompute compliance for the synced range
  await recomputeCompliance(connection.clientId, connectionId, since, until);

  return { success: true, postsUpserted };
}

/**
 * Sync follower counts for all enabled platform connections of a client.
 */
export async function syncFollowerSnapshots(clientId: string): Promise<void> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const connections = await prisma.platformConnection.findMany({
    where: { clientId, isEnabled: true, connectionStatus: ConnectionStatus.CONNECTED },
  });

  const today = formatInTimeZone(new Date(), client.timezone, "yyyy-MM-dd");

  for (const conn of connections) {
    const adapter = getAdapter(conn.platform);
    if (!adapter) continue;

    const config: AdapterConfig = {
      platform: conn.platform,
      clientId,
      connectionId: conn.id,
      externalAccountId: conn.externalAccountId ?? "",
      tokenReference: conn.tokenReference,
      timezone: client.timezone,
    };

    const count = await adapter.fetchFollowerCount(config);
    if (count === null) continue;

    await prisma.followerSnapshot.upsert({
      where: {
        clientId_platformConnectionId_snapshotDateLocal: {
          clientId,
          platformConnectionId: conn.id,
          snapshotDateLocal: today,
        },
      },
      create: {
        clientId,
        platformConnectionId: conn.id,
        platform: conn.platform,
        snapshotDateLocal: today,
        followerCount: count,
      },
      update: {
        followerCount: count,
        collectedAt: new Date(),
      },
    });
  }
}

/**
 * Run a full daily sync for all active clients.
 */
export async function runDailySync(triggeredById: string | null = null): Promise<void> {
  const job = await prisma.syncJob.create({
    data: {
      jobType: SyncJobType.POST_SYNC,
      scopeType: "ALL",
      triggeredById,
      status: SyncStatus.RUNNING,
    },
  });

  const activeClients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    include: {
      platformConnections: {
        where: { isEnabled: true },
      },
    },
  });

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  const errors: string[] = [];

  // Sync last 2 days to catch any delayed posts
  const since = startOfDay(subDays(new Date(), 2));
  const until = endOfDay(new Date());

  for (const client of activeClients) {
    for (const conn of client.platformConnections) {
      totalProcessed++;
      const result = await syncPlatformConnection(conn.id, since, until, triggeredById);

      if (result.success) {
        totalSucceeded++;
      } else {
        totalFailed++;
        errors.push(client.name + "/" + conn.platform + ": " + result.error);
      }
    }

    // Sync follower snapshots
    await syncFollowerSnapshots(client.id).catch((err) => {
      errors.push(client.name + "/followers: " + err.message);
    });
  }

  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      status: totalFailed === 0 ? SyncStatus.COMPLETED : totalSucceeded === 0 ? SyncStatus.FAILED : SyncStatus.PARTIAL,
      finishedAt: new Date(),
      itemsProcessed: totalProcessed,
      itemsSucceeded: totalSucceeded,
      itemsFailed: totalFailed,
      errorLogJson: errors.length > 0 ? JSON.stringify(errors) : null,
    },
  });
}

/**
 * Run a backfill for a specific client from a start date.
 */
export async function runBackfill(
  clientId: string,
  since: Date,
  until: Date = new Date(),
  triggeredById: string | null = null
): Promise<{ success: boolean; error?: string }> {
  const job = await prisma.syncJob.create({
    data: {
      jobType: SyncJobType.BACKFILL,
      scopeType: "CLIENT",
      scopeId: clientId,
      clientId,
      triggeredById,
      status: SyncStatus.RUNNING,
      notes: "Backfill from " + since.toISOString() + " to " + until.toISOString(),
    },
  });

  try {
    const connections = await prisma.platformConnection.findMany({
      where: { clientId, isEnabled: true },
    });

    let total = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const conn of connections) {
      total++;
      const result = await syncPlatformConnection(conn.id, since, until, triggeredById);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
        errors.push(conn.platform + ": " + result.error);
      }
    }

    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: failed === 0 ? SyncStatus.COMPLETED : succeeded === 0 ? SyncStatus.FAILED : SyncStatus.PARTIAL,
        finishedAt: new Date(),
        itemsProcessed: total,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
        errorLogJson: errors.length > 0 ? JSON.stringify(errors) : null,
      },
    });

    return { success: true };
  } catch (err) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorLogJson: JSON.stringify([err instanceof Error ? err.message : String(err)]),
      },
    });

    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
