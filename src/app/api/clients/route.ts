import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { UserRole, ClientStatus } from "@prisma/client";
import { z } from "zod";

const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  timezone: z.string().default("America/New_York"),
  status: z.nativeEnum(ClientStatus).default(ClientStatus.DRAFT),
  campaignStartDate: z.string().datetime().optional().nullable(),
  reportingStartDate: z.string().datetime().optional().nullable(),
  internalOwner: z.string().optional().nullable(),
  website: z.string().url().optional().nullable(),
  industry: z.string().optional().nullable(),
  billingStatus: z.string().optional().nullable(),
  contractStatus: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole(UserRole.OPERATIONS);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const includeArchived = searchParams.get("includeArchived") === "true";

  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status;
  } else if (!includeArchived) {
    where.status = { not: ClientStatus.ARCHIVED };
  }

  const clients = await prisma.client.findMany({
    where,
    include: {
      platformConnections: {
        where: { isEnabled: true },
        select: {
          id: true,
          platform: true,
          connectionStatus: true,
          isMandatory: true,
          lastSyncAt: true,
          lastSyncError: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ success: true, data: clients });
}

export async function POST(req: NextRequest) {
  let user: { id?: string; name?: string; role?: string };
  try {
    user = await requireRole(UserRole.ADMIN);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Check slug uniqueness
  const existing = await prisma.client.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    return NextResponse.json({ success: false, error: "Slug already taken" }, { status: 409 });
  }

  const client = await prisma.client.create({
    data: {
      ...parsed.data,
      campaignStartDate: parsed.data.campaignStartDate ? new Date(parsed.data.campaignStartDate) : null,
      reportingStartDate: parsed.data.reportingStartDate ? new Date(parsed.data.reportingStartDate) : null,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id ?? null,
      actionType: "CLIENT_CREATED",
      entityType: "Client",
      entityId: client.id,
      afterJson: JSON.stringify(client),
    },
  });

  return NextResponse.json({ success: true, data: client }, { status: 201 });
}
