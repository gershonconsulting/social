export const runtime = 'edge';
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ConnectionStatus, Platform } from "@prisma/client";

/**
 * GET /api/errors
 *
 * Returns everything currently or recently going wrong on the platform,
 * aggregated from multiple sources so the user has one place to look.
 *
 *   activeIssues: every platformConnection (LinkedIn/Twitter/GMB) whose
 *     lastSyncError is non-null OR connectionStatus is not CONNECTED.
 *     Includes client name, last sync time, and the recommended fix.
 *
 *   recentFailures: last 100 SyncJob runs with status FAILED or PARTIAL,
 *     including their per-platform breakdown so each individual platform
 *     error is visible — not just 'something failed in this run'.
 */
export async function GET() {
  try {
    const SUPPORTED: Platform[] = [Platform.LINKEDIN, Platform.TWITTER, Platform.GOOGLE_BUSINESS];

    // 1. Active connection issues
    const conns = await prisma.platformConnection.findMany({
      where: {
        isEnabled: true,
        platform: { in: SUPPORTED },
        OR: [
          { lastSyncError: { not: null } },
          { connectionStatus: { not: ConnectionStatus.CONNECTED } },
        ],
      },
      include: { client: { select: { id: true, name: true, status: true } } },
      orderBy: [{ lastSyncAt: "desc" }],
    });

    const activeIssues = conns
      .filter((c) => c.client?.status !== "ARCHIVED")
      .map((c) => {
        let recommendedFix = "Check connection in /settings";
        const err = c.lastSyncError ?? "";
        if (/expired|401|65601/i.test(err)) recommendedFix = "Reconnect in /settings (token expired)";
        else if (/403|permission|MARKETING|insufficient/i.test(err)) recommendedFix = "App may need Community Management API approval, or you're not an admin of this org";
        else if (/no\s+x.*user\s+id|no\s+account\s+id/i.test(err)) recommendedFix = "Twitter cookies or @handle missing — capture via /settings bookmarklet";
        else if (/no.*location.*id|discover/i.test(err)) recommendedFix = "Google Business location discovery failing (worker timeout)";
        else if (/no.*token|no.*session/i.test(err)) recommendedFix = "No credentials on file — reconnect in /settings";
        else if (c.connectionStatus === ConnectionStatus.PENDING) recommendedFix = "Never authorized — reconnect in /settings";

        return {
          id: c.id,
          clientId: c.clientId,
          clientName: c.client?.name ?? "?",
          platform: c.platform,
          status: c.connectionStatus,
          lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
          error: c.lastSyncError,
          recommendedFix,
        };
      });

    // 2. Recent failed/partial sync runs
    const jobs = await prisma.syncJob.findMany({
      where: { status: { in: ["FAILED", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        client: { select: { id: true, name: true } },
      },
    });

    const recentFailures = jobs.map((j) => {
      let perPlatform: Array<{ platform: string; success: boolean; error: string | null; postsUpserted: number }> = [];
      if (j.resultsJson) {
        try {
          const parsed = JSON.parse(j.resultsJson);
          if (Array.isArray(parsed)) {
            perPlatform = parsed.map((p) => ({
              platform: String(p.platform),
              success: !!p.success,
              error: p.error ?? null,
              postsUpserted: Number(p.postsUpserted ?? 0),
            }));
          }
        } catch {}
      }
      const errorLog: string[] = (() => {
        if (!j.errorLogJson) return [];
        try {
          const x = JSON.parse(j.errorLogJson);
          return Array.isArray(x) ? x : [String(x)];
        } catch {
          return [j.errorLogJson];
        }
      })();
      return {
        id: j.id,
        startedAt: j.startedAt.toISOString(),
        finishedAt: j.finishedAt?.toISOString() ?? null,
        clientId: j.clientId,
        clientName: j.client?.name ?? null,
        status: j.status,
        itemsProcessed: j.itemsProcessed,
        itemsFailed: j.itemsFailed,
        itemsSucceeded: j.itemsSucceeded,
        perPlatform,
        errorLog,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        activeIssues,
        recentFailures,
        summary: {
          activeCount: activeIssues.length,
          recentFailedCount: recentFailures.length,
          byPlatform: SUPPORTED.reduce(
            (m, p) => ({ ...m, [p]: activeIssues.filter((i) => i.platform === p).length }),
            {} as Record<string, number>
          ),
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load errors";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
