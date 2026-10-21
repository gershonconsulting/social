export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";

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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await guardRole(); // v4.59.0 audit: role check
  if (denied) return denied;
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) {
    return NextResponse.json({ success: false, error: "Client not found" }, { status: 404 });
  }

  if (client.status !== ClientStatus.ARCHIVED) {
    return NextResponse.json({ success: false, error: "Client is not archived" }, { status: 409 });
  }

  const restored = await prisma.client.update({
    where: { id },
    data: {
      status: ClientStatus.ACTIVE,
      archivedAt: null,
      archiveReason: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      actionType: "CLIENT_RESTORED",
      entityType: "Client",
      entityId: client.id,
      beforeJson: JSON.stringify(client),
      afterJson: JSON.stringify(restored),
    },
  });

  return NextResponse.json({ success: true, data: restored });
}
