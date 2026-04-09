export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { UserRole, ClientStatus } from "@prisma/client";
import { z } from "zod";

const updateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  timezone: z.string().optional(),
  status: z.nativeEnum(ClientStatus).optional(),
  campaignStartDate: z.string().datetime().optional().nullable(),
  reportingStartDate: z.string().datetime().optional().nullable(),
  internalOwner: z.string().optional().nullable(),
  website: z.string().url().optional().nullable(),
  industry: z.string().optional().nullable(),
  billingStatus: z.string().optional().nullable(),
  contractStatus: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(UserRole.OPERATIONS);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      platformConnections: {
        include: { postingSchedules: true },
        orderBy: { platform: "asc" },
      },
    },
  });

  if (!client) {
    return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: client });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: { id?: string };
  try {
    user = await requireRole(UserRole.ADMIN);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

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

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id ?? null,
      actionType: "CLIENT_UPDATED",
      entityType: "Client",
      entityId: client.id,
      beforeJson: JSON.stringify(client),
      afterJson: JSON.stringify(updated),
    },
  });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: { id?: string };
  try {
    user = await requireRole(UserRole.ADMIN);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const reason = searchParams.get("reason") ?? "Archived by admin";

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) {
    return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
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
      actorUserId: user.id ?? null,
      actionType: "CLIENT_ARCHIVED",
      entityType: "Client",
      entityId: client.id,
      beforeJson: JSON.stringify(client),
      afterJson: JSON.stringify(archived),
    },
  });

  return NextResponse.json({ success: true, data: archived });
}
