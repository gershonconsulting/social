/**
 * Compliance Engine
 *
 * Computes and persists DailyCompliance records for each client/platform/date.
 * Runs after posts are synced. Can be re-run to recompute any date range.
 */

import { Platform, PostingSchedule, ComplianceStatus } from "@prisma/client";
import prisma from "@/lib/db";
import { getExpectedPostingDates } from "./schedule";
import { format, parseISO, eachDayOfInterval } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

export interface ComplianceRunResult {
  clientId: string;
  platformConnectionId: string;
  platform: Platform;
  datesProcessed: number;
  datesExpected: number;
  datesVerified: number;
  datesMissing: number;
}

/**
 * Recompute compliance for one platform connection over a date range.
 */
export async function recomputeCompliance(
  clientId: string,
  platformConnectionId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<ComplianceRunResult> {
  const [connection, client] = await Promise.all([
    prisma.platformConnection.findUniqueOrThrow({ where: { id: platformConnectionId } }),
    prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
  ]);

  const schedule = await prisma.postingSchedule.findFirst({
    where: { clientId, platformConnectionId },
  });

  const timezone = client.timezone;
  const platform = connection.platform;

  // Determine which dates are expected
  const expectedDates = new Set(
    schedule
      ? getExpectedPostingDates(schedule, rangeStart, rangeEnd, timezone)
      : []
  );

  // All dates in the range (as local date strings)
  const localStart = toZonedTime(rangeStart, timezone);
  const localEnd = toZonedTime(rangeEnd, timezone);
  const allLocalDates = eachDayOfInterval({ start: localStart, end: localEnd }).map((d) =>
    format(d, "yyyy-MM-dd")
  );

  // Fetch all posts in range for this connection
  const rangeStartStr = format(localStart, "yyyy-MM-dd");
  const rangeEndStr = format(localEnd, "yyyy-MM-dd");

  const posts = await prisma.socialPost.findMany({
    where: {
      clientId,
      platformConnectionId,
      publishedDateLocal: { gte: rangeStartStr, lte: rangeEndStr },
    },
    orderBy: { publishedAtUtc: "asc" },
  });

  // Group posts by date
  const postsByDate = new Map<string, typeof posts>();
  for (const post of posts) {
    if (!postsByDate.has(post.publishedDateLocal)) {
      postsByDate.set(post.publishedDateLocal, []);
    }
    postsByDate.get(post.publishedDateLocal)!.push(post);
  }

  // Determine connection health
  const isConnected = connection.connectionStatus === "CONNECTED";
  const hasExpiredToken =
    connection.tokenReference === null ||
    (connection.tokenExpiresAt !== null && connection.tokenExpiresAt < new Date());

  let datesExpected = 0;
  let datesVerified = 0;
  let datesMissing = 0;

  const upserts: Promise<unknown>[] = [];

  for (const dateStr of allLocalDates) {
    const isExpected = expectedDates.has(dateStr);
    const dayPosts = postsByDate.get(dateStr) ?? [];

    // Check enforcement window
    const isInEnforcementWindow =
      (!connection.enforcementStartDate || parseISO(dateStr) >= connection.enforcementStartDate) &&
      (!connection.enforcementEndDate || parseISO(dateStr) <= connection.enforcementEndDate);

    const shouldExpect = isExpected && connection.isEnabled && isInEnforcementWindow;

    if (shouldExpect) datesExpected++;

    let status: ComplianceStatus;
    let errorCode: string | null = null;
    let errorMsg: string | null = null;
    let primaryPostId: string | null = null;
    let primaryPostUrl: string | null = null;

    if (!connection.isEnabled) {
      status = ComplianceStatus.GRAY;
    } else if (!shouldExpect) {
      status = ComplianceStatus.GRAY;
    } else if (dayPosts.length > 0) {
      // Verified
      status = ComplianceStatus.GREEN;
      const primary = dayPosts[0];
      primaryPostId = primary.id;
      primaryPostUrl = primary.postUrl;
      datesVerified++;
    } else if (!isConnected || hasExpiredToken) {
      // Could not verify due to connection issue
      status = ComplianceStatus.YELLOW;
      errorCode = hasExpiredToken ? "TOKEN_EXPIRED" : "NOT_CONNECTED";
      errorMsg = hasExpiredToken
        ? "Platform token expired — could not verify posting"
        : "Platform not connected — could not verify posting";
    } else if (connection.lastSyncError) {
      status = ComplianceStatus.YELLOW;
      errorCode = "SYNC_ERROR";
      errorMsg = connection.lastSyncError;
    } else {
      // Expected but no post found and connection is healthy
      status = ComplianceStatus.RED;
      datesMissing++;
    }

    upserts.push(
      prisma.dailyCompliance.upsert({
        where: {
          clientId_platformConnectionId_dateLocal: {
            clientId,
            platformConnectionId,
            dateLocal: dateStr,
          },
        },
        create: {
          clientId,
          platformConnectionId,
          platform,
          dateLocal: dateStr,
          expectedFlag: shouldExpect,
          status,
          verifiedPostCount: dayPosts.length,
          primaryPostId,
          primaryPostUrl,
          verificationSource: "AUTOMATED",
          verificationErrorCode: errorCode,
          verificationErrorMsg: errorMsg,
          verifiedAt: new Date(),
        },
        update: {
          expectedFlag: shouldExpect,
          status,
          verifiedPostCount: dayPosts.length,
          primaryPostId,
          primaryPostUrl,
          verificationSource: "AUTOMATED",
          verificationErrorCode: errorCode,
          verificationErrorMsg: errorMsg,
          verifiedAt: new Date(),
        },
      })
    );
  }

  await Promise.all(upserts);

  return {
    clientId,
    platformConnectionId,
    platform,
    datesProcessed: allLocalDates.length,
    datesExpected,
    datesVerified,
    datesMissing,
  };
}

/**
 * Recompute compliance for all enabled platform connections of a client.
 */
export async function recomputeClientCompliance(
  clientId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<ComplianceRunResult[]> {
  const connections = await prisma.platformConnection.findMany({
    where: { clientId, isEnabled: true },
  });

  const results: ComplianceRunResult[] = [];
  for (const conn of connections) {
    const result = await recomputeCompliance(clientId, conn.id, rangeStart, rangeEnd);
    results.push(result);
  }

  return results;
}

/**
 * Get the compliance summary for a client on a specific date.
 */
export async function getDayComplianceSummary(
  clientId: string,
  dateLocal: string
): Promise<{
  overallStatus: ComplianceStatus;
  platformStatuses: Record<string, ComplianceStatus>;
  missingCount: number;
  unknownCount: number;
}> {
  const records = await prisma.dailyCompliance.findMany({
    where: { clientId, dateLocal },
    include: { platformConnection: true },
  });

  const platformStatuses: Record<string, ComplianceStatus> = {};
  let missingCount = 0;
  let unknownCount = 0;

  for (const record of records) {
    if (record.expectedFlag) {
      platformStatuses[record.platform] = record.status;
      if (record.status === ComplianceStatus.RED) missingCount++;
      if (record.status === ComplianceStatus.YELLOW) unknownCount++;
    }
  }

  let overallStatus: ComplianceStatus;
  if (missingCount > 0) overallStatus = ComplianceStatus.RED;
  else if (unknownCount > 0) overallStatus = ComplianceStatus.YELLOW;
  else if (Object.values(platformStatuses).every((s) => s === ComplianceStatus.GREEN)) {
    overallStatus = ComplianceStatus.GREEN;
  } else {
    overallStatus = ComplianceStatus.GRAY;
  }

  return { overallStatus, platformStatuses, missingCount, unknownCount };
}
