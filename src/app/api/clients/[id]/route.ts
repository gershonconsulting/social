export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType, UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { z } from "zod";

// v4.59.0 audit: mutating routes need OPERATIONS or above (ADMIN — the owner —
// keeps access). Middleware already makes /api session-only; this adds the role.
async function guardRole(): Promise<NextResponse | null> {
  try {
    await requireRole(UserRole.OPERATIONS);
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "You do not have permission to do this" }, { status: 403 });
    return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  }
}

const updateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().optional(),
  status: z.nativeEnum(ClientStatus).optional(),
  campaignStartDate: z.string().datetime().optional().nullable(),
  reportingStartDate: z.string().datetime().optional().nullable(),
  internalOwner: z.string().optional().nullable(),
  website: z.string().url().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
  industry: z.string().optional().nullable(),
  billingStatus: z.string().optional().nullable(),
  contractStatus: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  clientType: z.nativeEnum(ClientType).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Keep this LIGHT for the Cloudflare edge worker (was intermittently 500ing
    // with error 1102 "exceeded resource limits"): the detail page does not use
    // followerSnapshots, so we no longer eagerly load them, and we run the client
    // lookup and the post aggregate in parallel instead of sequentially.
    const [client, agg] = await Promise.all([
      prisma.client.findUnique({
        where: { id },
        include: {
          platformConnections: { orderBy: { platform: "asc" } },
        },
      }),
      // "Last content collected" — last time we wrote post data for this company
      // (same signal the dashboard collection panel uses), plus newest post date
      // and total post count.
      prisma.socialPost.aggregate({
        where: { clientId: id },
        _max: { updatedAt: true, publishedDateLocal: true },
        _count: { _all: true },
      }),
    ]);

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...client,
        lastCollectedAt: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
        latestPostDate: agg._max.publishedDateLocal ?? null,
        postCount: agg._count._all,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load client";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardRole(); // v4.59.0 audit: role check
  if (denied) return denied;
  try {
    const { id } = await params;
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = updateClientSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...parsed.data,
        campaignStartDate: parsed.data.campaignStartDate
          ? new Date(parsed.data.campaignStartDate)
          : parsed.data.campaignStartDate === null ? null : undefined,
        reportingStartDate: parsed.data.reportingStartDate
          ? new Date(parsed.data.reportingStartDate)
          : parsed.data.reportingStartDate === null ? null : undefined,
      },
    });

    // Audit log is best-effort — do not let an audit failure roll back the user-facing update.
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: null,
          actionType: "CLIENT_UPDATED",
          entityType: "Client",
          entityId: client.id,
          beforeJson: JSON.stringify(client),
          afterJson: JSON.stringify(updated),
        },
      });
    } catch {
      // ignore — audit failures should not break edits
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update client";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardRole(); // v4.59.0 audit: role check
  if (denied) return denied;
  try {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const reason = searchParams.get("reason") ?? "Archived by admin";
  const hard = searchParams.get("hard") === "true";

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) {
    return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
  }

  // Hard delete: permanently remove this client and ALL related rows.
  // Schema doesn't declare onDelete: Cascade, so we delete children first,
  // wrapped in a transaction so a failure mid-delete leaves no orphans.
  if (hard) {
    const connectionIds = await prisma.platformConnection.findMany({
      where: { clientId: id },
      select: { id: true },
    });
    const connIdList = connectionIds.map((c) => c.id);

    await prisma.$transaction([
      prisma.dailyCompliance.deleteMany({ where: { clientId: id } }),
      prisma.followerSnapshot.deleteMany({ where: { clientId: id } }),
      prisma.socialPost.deleteMany({ where: { clientId: id } }),
      // v4.59.0 audit: these two have a required clientId FK and were missing,
      // so a permanent delete failed with a foreign-key error.
      prisma.postPrompt.deleteMany({ where: { clientId: id } }),
      prisma.contentAnalysis.deleteMany({ where: { clientId: id } }),
      // v4.59.0 audit: also catch schedules keyed by clientId.
      prisma.postingSchedule.deleteMany({
        where: { OR: [{ clientId: id }, { platformConnectionId: { in: connIdList } }] },
      }),
      prisma.platformConnection.deleteMany({ where: { clientId: id } }),
      prisma.syncJob.deleteMany({ where: { clientId: id } }),
      prisma.auditLog.create({
        data: {
          actorUserId: null,
          actionType: "CLIENT_HARD_DELETED",
          entityType: "Client",
          entityId: id,
          beforeJson: JSON.stringify(client),
          afterJson: null,
        },
      }),
      prisma.client.delete({ where: { id } }),
    ]);
    return NextResponse.json({ success: true, data: { hardDeleted: true, id } });
  }

  if (client.status === ClientStatus.ARCHIVED) {
    return NextResponse.json({ success: false, error: "Client is already archived" }, { status: 409 });
  }

  const archived = await prisma.client.update({
    where: { id },
    data: { status: ClientStatus.ARCHIVED, archivedAt: new Date(), archiveReason: reason },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      actionType: "CLIENT_ARCHIVED",
      entityType: "Client",
      entityId: client.id,
      beforeJson: JSON.stringify(client),
      afterJson: JSON.stringify(archived),
    },
  });

    return NextResponse.json({ success: true, data: archived });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete client";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
