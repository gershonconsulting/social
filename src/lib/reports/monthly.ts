/**
 * Monthly Report Engine
 *
 * Generates compliance reports for a given client and month.
 * Reads pre-computed DailyCompliance records and follower snapshots.
 */

import prisma from "@/lib/db";
import { ComplianceStatus, Platform } from "@prisma/client";
import { ClientMonthlyReport, PlatformMonthlyReport, PLATFORM_LABELS } from "@/types";
import { format, getDaysInMonth } from "date-fns";

type BadgeType = "100_PCT" | "BELOW_TARGET" | "INCOMPLETE_VERIFICATION";

function determineBadge(
  completionRate: number,
  unknownDays: number
): BadgeType {
  if (unknownDays > 0) return "INCOMPLETE_VERIFICATION";
  if (completionRate >= 1.0) return "100_PCT";
  return "BELOW_TARGET";
}

/**
 * Generate a full monthly compliance report for a client.
 */
export async function generateMonthlyReport(
  clientId: string,
  year: number,
  month: number // 1-indexed
): Promise<ClientMonthlyReport> {
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const datePrefix = `${monthStr}-`;

  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });

  // Fetch all daily compliance records for this month
  const complianceRecords = await prisma.dailyCompliance.findMany({
    where: {
      clientId,
      dateLocal: { startsWith: datePrefix },
    },
    include: { platformConnection: true },
    orderBy: [{ platform: "asc" }, { dateLocal: "asc" }],
  });

  // Group by platform connection
  const byConnection = new Map<string, typeof complianceRecords>();
  for (const record of complianceRecords) {
    if (!byConnection.has(record.platformConnectionId)) {
      byConnection.set(record.platformConnectionId, []);
    }
    byConnection.get(record.platformConnectionId)!.push(record);
  }

  // Fetch follower snapshots for start and end of month
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const monthStartDate = `${monthStr}-01`;
  const monthEndDate = `${monthStr}-${String(daysInMonth).padStart(2, "0")}`;

  const followerSnapshots = await prisma.followerSnapshot.findMany({
    where: {
      clientId,
      snapshotDateLocal: { gte: monthStartDate, lte: monthEndDate },
    },
    orderBy: { snapshotDateLocal: "asc" },
  });

  // Group follower snapshots by connectionId
  const followerByConnection = new Map<
    string,
    { first: number | null; last: number | null }
  >();
  for (const snap of followerSnapshots) {
    const existing = followerByConnection.get(snap.platformConnectionId);
    if (!existing) {
      followerByConnection.set(snap.platformConnectionId, {
        first: snap.followerCount,
        last: snap.followerCount,
      });
    } else {
      existing.last = snap.followerCount;
    }
  }

  // Build per-platform reports
  const platformReports: PlatformMonthlyReport[] = [];
  let totalExpected = 0;
  let totalVerified = 0;
  let totalMissing = 0;
  let totalUnknown = 0;

  for (const [connId, records] of byConnection.entries()) {
    const platform = records[0].platform;
    const platformLabel = PLATFORM_LABELS[platform] ?? platform;

    let expectedDays = 0;
    let verifiedDays = 0;
    let missingDays = 0;
    let unknownDays = 0;
    const missingDates: string[] = [];
    const verifiedLinks: { date: string; url: string }[] = [];
    const connectionIssues: string[] = [];

    for (const record of records) {
      if (!record.expectedFlag) continue;

      expectedDays++;

      if (record.status === ComplianceStatus.GREEN) {
        verifiedDays++;
        if (record.primaryPostUrl) {
          verifiedLinks.push({ date: record.dateLocal, url: record.primaryPostUrl });
        }
      } else if (record.status === ComplianceStatus.RED) {
        missingDays++;
        missingDates.push(record.dateLocal);
      } else if (record.status === ComplianceStatus.YELLOW) {
        unknownDays++;
        if (record.verificationErrorMsg && !connectionIssues.includes(record.verificationErrorMsg)) {
          connectionIssues.push(record.verificationErrorMsg);
        }
      }
    }

    const completionRate = expectedDays > 0 ? verifiedDays / expectedDays : 0;
    const badge = determineBadge(completionRate, unknownDays);

    const followerData = followerByConnection.get(connId);
    const followerStart = followerData?.first ?? null;
    const followerEnd = followerData?.last ?? null;
    const followerGrowth =
      followerStart !== null && followerEnd !== null ? followerEnd - followerStart : null;

    platformReports.push({
      platform,
      platformLabel,
      expectedDays,
      verifiedDays,
      missingDays,
      unknownDays,
      completionRate,
      missingDates,
      verifiedLinks,
      followerStart,
      followerEnd,
      followerGrowth,
      connectionIssues,
      badge,
    });

    totalExpected += expectedDays;
    totalVerified += verifiedDays;
    totalMissing += missingDays;
    totalUnknown += unknownDays;
  }

  const overallRate = totalExpected > 0 ? totalVerified / totalExpected : 0;

  return {
    clientId,
    clientName: client.name,
    month: monthStr,
    totalExpectedPlatformDays: totalExpected,
    totalVerifiedPlatformDays: totalVerified,
    totalMissingPlatformDays: totalMissing,
    totalUnknownPlatformDays: totalUnknown,
    overallCompletionRate: overallRate,
    platforms: platformReports.sort((a, b) => b.expectedDays - a.expectedDays),
    generatedAt: new Date().toISOString(),
    hasVerificationIssues: totalUnknown > 0,
  };
}

/**
 * Get a list of months for which a client has compliance data.
 */
export async function getAvailableMonths(clientId: string): Promise<string[]> {
  const records = await prisma.dailyCompliance.findMany({
    where: { clientId },
    select: { dateLocal: true },
    distinct: ["dateLocal"],
    orderBy: { dateLocal: "desc" },
  });

  const months = new Set<string>();
  for (const r of records) {
    months.add(r.dateLocal.slice(0, 7));
  }

  return Array.from(months).sort().reverse();
}
