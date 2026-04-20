export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus } from "@prisma/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
