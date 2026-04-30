export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ConnectionStatus } from "@prisma/client";
import { z } from "zod";

const updatePlatformSchema = z.object({
  externalAccountId: z.string().optional().nullable(),
  externalAccountName: z.string().optional().nullable(),
  externalAccountUrl: z.string().url().optional().nullable(),
  isMandatory: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  tokenReference: z.string().optional().nullable(),
  tokenExpiresAt: z.string().datetime().optional().nullable(),
  enforcementStartDate: z.string().datetime().optional().nullable(),
  enforcementEndDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  connectionStatus: z.nativeEnum(ConnectionStatus).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const connection = await prisma.platformConnection.findUnique({ where: { id } });
    if (!connection) {
      return NextResponse.json({ success: false, error: "Platform connection not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = updatePlatformSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // If the externalAccountUrl is being changed, clear the cached
    // externalAccountId so the next sync re-runs discovery against the new URL.
    // Also clear lastSyncError so the user sees a fresh start.
    const isUrlChanging =
      parsed.data.externalAccountUrl !== undefined &&
      parsed.data.externalAccountUrl !== connection.externalAccountUrl;
    const clearedDiscovery = isUrlChanging
      ? { externalAccountId: null, externalAccountName: null, lastSyncError: null }
      : {};

    const updated = await prisma.platformConnection.update({
      where: { id },
      data: {
        ...parsed.data,
        ...clearedDiscovery,
        tokenExpiresAt: parsed.data.tokenExpiresAt ? new Date(parsed.data.tokenExpiresAt) : undefined,
        enforcementStartDate: parsed.data.enforcementStartDate
          ? new Date(parsed.data.enforcementStartDate)
          : undefined,
        enforcementEndDate: parsed.data.enforcementEndDate
          ? new Date(parsed.data.enforcementEndDate)
          : undefined,
      },
    });

    try {
      await prisma.auditLog.create({
        data: {
          actionType: "PLATFORM_CONNECTED",
          entityType: "PlatformConnection",
          entityId: connection.id,
          beforeJson: JSON.stringify(connection),
          afterJson: JSON.stringify(updated),
        },
      });
    } catch {
      // audit log failure is non-fatal
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update connection";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {

  const { id } = await params;
  const connection = await prisma.platformConnection.findUnique({ where: { id } });
  if (!connection) {
    return NextResponse.json({ success: false, error: "Platform connection not found" }, { status: 404 });
  }

  // Soft-disable rather than delete (preserves historical records)
  const updated = await prisma.platformConnection.update({
    where: { id },
    data: {
      isEnabled: false,
      connectionStatus: ConnectionStatus.DISCONNECTED,
    },
  });

  await prisma.auditLog.create({
    data: {
      actionType: "PLATFORM_DISCONNECTED",
      entityType: "PlatformConnection",
      entityId: connection.id,
      beforeJson: JSON.stringify(connection),
      afterJson: JSON.stringify(updated),
    },
  });

  return NextResponse.json({ success: true, data: updated });
}
