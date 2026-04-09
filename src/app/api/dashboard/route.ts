import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { UserRole, ClientStatus, ComplianceStatus } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { DashboardSummary, ClientDashboardRow } from "@/types";

export async function GET(_req: NextRequest) {
  try {
    await requireRole(UserRole.OPERATIONS);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const today = formatInTimeZone(new Date(), "America/New_York", "yyyy-MM-dd");

  // Fetch active clients with their platform connections and today's compliance
  const clients = await prisma.client.findMany({
    where: { status: ClientStatus.ACTIVE },
    include: {
      platformConnections: {
        where: { isEnabled: true },
        include: {
          dailyCompliance: {
            where: { dateLocal: today },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows: ClientDashboardRow[] = [];
  let clientsMissingToday = 0;
  let clientsWithErrors = 0;
  let clientsFullyCompliant = 0;
  let totalPostsToday = 0;
  let totalUnknown = 0;

  for (const client of clients) {
    const todayDate = formatInTimeZone(new Date(), client.timezone, "yyyy-MM-dd");

    // Get compliance records for this client's timezone today
    const platformStatuses: Record<string, ComplianceStatus> = {};
    let clientMissing = false;
    let clientUnknown = false;
    let clientHasError = false;
    let connectionIssues = 0;

    for (const conn of client.platformConnections) {
      if (conn.connectionStatus === "ERROR" || conn.connectionStatus === "EXPIRED") {
        clientHasError = true;
        connectionIssues++;
      }

      const todayRecord = conn.dailyCompliance.find(
        (r) => r.dateLocal === todayDate && r.expectedFlag
      );

      if (todayRecord) {
        platformStatuses[conn.platform] = todayRecord.status;
        if (todayRecord.status === ComplianceStatus.RED) clientMissing = true;
        if (todayRecord.status === ComplianceStatus.YELLOW) clientUnknown = true;
        if (todayRecord.status === ComplianceStatus.GREEN)
          totalPostsToday += todayRecord.verifiedPostCount;
      }
    }

    if (clientMissing) clientsMissingToday++;
    if (clientHasError) clientsWithErrors++;
    if (!clientMissing && !clientUnknown && Object.keys(platformStatuses).length > 0) {
      if (Object.values(platformStatuses).every((s) => s === ComplianceStatus.GREEN))
        clientsFullyCompliant++;
    }
    if (clientUnknown) totalUnknown++;

    let overallStatus: ComplianceStatus;
    if (clientMissing) overallStatus = ComplianceStatus.RED;
    else if (clientUnknown) overallStatus = ComplianceStatus.YELLOW;
    else if (Object.values(platformStatuses).every((s) => s === ComplianceStatus.GREEN))
      overallStatus = ComplianceStatus.GREEN;
    else overallStatus = ComplianceStatus.GRAY;

    // Find last sync time
    const lastSync = client.platformConnections
      .map((c) => c.lastSyncAt)
      .filter(Boolean)
      .sort()
      .reverse()[0];

    rows.push({
      id: client.id,
      name: client.name,
      slug: client.slug,
      status: client.status,
      todayOverallStatus: overallStatus,
      linkedinStatus: (platformStatuses["LINKEDIN"] as string) ?? null,
      twitterStatus: (platformStatuses["TWITTER"] as string) ?? null,
      googleBusinessStatus: (platformStatuses["GOOGLE_BUSINESS"] as string) ?? null,
      optionalPlatformSummary: buildOptionalSummary(platformStatuses),
      lastSyncAt: lastSync?.toISOString() ?? null,
      connectionIssueCount: connectionIssues,
    });
  }

  const summary: DashboardSummary = {
    totalActiveClients: clients.length,
    clientsMissingPostsToday,
    clientsWithConnectionErrors: clientsWithErrors,
    clientsFullyCompliantToday: clientsFullyCompliant,
    totalPostsDetectedToday: totalPostsToday,
    totalUnknownVerificationsToday: totalUnknown,
    lastUpdated: new Date().toISOString(),
  };

  return NextResponse.json({ success: true, data: { summary, clients: rows } });
}

function buildOptionalSummary(statuses: Record<string, ComplianceStatus>): string {
  const coreplatforms = new Set(["LINKEDIN", "TWITTER", "GOOGLE_BUSINESS"]);
  const optional = Object.entries(statuses).filter(([p]) => !coreplatforms.has(p));
  if (optional.length === 0) return "—";
  const green = optional.filter(([, s]) => s === ComplianceStatus.GREEN).length;
  return `${green}/${optional.length}`;
}
