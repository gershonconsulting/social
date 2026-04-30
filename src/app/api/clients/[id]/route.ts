export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType } from "@prisma/client";
import { z } from "zod";

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
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        platformConnections: {
          include: {
            postingSchedules: true,
            followerSnapshots: {
              orderBy: { snapshotDateLocal: "desc" },
              take: 31,
            },
          },
          orderBy: { platform: "asc" },
        },
      },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: client });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load client";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
      prisma.postingSchedule.deleteMany({ where: { platformConnectionId: { in: connIdList } } }),
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
