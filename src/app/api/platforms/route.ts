import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { UserRole, Platform, ConnectionStatus, PostingMode } from "@prisma/client";
import { z } from "zod";

const createPlatformSchema = z.object({
  clientId: z.string(),
  platform: z.nativeEnum(Platform),
  externalAccountId: z.string().optional().nullable(),
  externalAccountName: z.string().optional().nullable(),
  externalAccountUrl: z.string().url().optional().nullable(),
  isMandatory: z.boolean().default(true),
  isEnabled: z.boolean().default(true),
  tokenReference: z.string().optional().nullable(),
  tokenExpiresAt: z.string().datetime().optional().nullable(),
  enforcementStartDate: z.string().datetime().optional().nullable(),
  enforcementEndDate: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Posting schedule
  postingMode: z.nativeEnum(PostingMode).default(PostingMode.WORKING_DAYS),
  weekdaysJson: z.string().optional().nullable(),
  exclusionDatesJson: z.string().optional().nullable(),
  holidayCalendarJson: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  let user: { id?: string };
  try {
    user = await requireRole(UserRole.ADMIN);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createPlatformSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { postingMode, weekdaysJson, exclusionDatesJson, holidayCalendarJson, ...connData } = parsed.data;

  // Check for existing connection
  const existing = await prisma.platformConnection.findUnique({
    where: { clientId_platform: { clientId: connData.clientId, platform: connData.platform } },
  });

  if (existing) {
    return NextResponse.json(
      { success: false, error: "Platform connection already exists for this client" },
      { status: 409 }
    );
  }

  const connection = await prisma.platformConnection.create({
    data: {
      ...connData,
      connectionStatus: connData.tokenReference ? ConnectionStatus.PENDING : ConnectionStatus.DISCONNECTED,
      tokenExpiresAt: connData.tokenExpiresAt ? new Date(connData.tokenExpiresAt) : null,
      enforcementStartDate: connData.enforcementStartDate ? new Date(connData.enforcementStartDate) : null,
      enforcementEndDate: connData.enforcementEndDate ? new Date(connData.enforcementEndDate) : null,
    },
  });

  // Create associated posting schedule
  await prisma.postingSchedule.create({
    data: {
      clientId: connData.clientId,
      platformConnectionId: connection.id,
      mode: postingMode,
      weekdaysJson,
      exclusionDatesJson,
      holidayCalendarJson,
      useWorkingDays: postingMode === PostingMode.WORKING_DAYS,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id ?? null,
      actionType: "PLATFORM_CONNECTED",
      entityType: "PlatformConnection",
      entityId: connection.id,
      afterJson: JSON.stringify(connection),
    },
  });

  return NextResponse.json({ success: true, data: connection }, { status: 201 });
}
