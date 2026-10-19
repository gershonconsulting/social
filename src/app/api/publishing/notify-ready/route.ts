export const runtime = "edge";
/**
 * POST /api/publishing/notify-ready { ids?: string[], clientId?: string } (v4.54.0)
 * Re-sends the "validated — ready for publishing" email (to Settings → Publishing
 * readyEmail, default social@gershonconsulting.com) for approved/scheduled posts.
 * Without ids: every approved or scheduled post of the company not yet published.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { notifyReadyForPublishing } from "@/lib/publishing";

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = ((await req.json().catch(() => null)) || {}) as { ids?: string[]; clientId?: string };
  const rows = await prisma.contentItem.findMany({
    where: {
      organizationId: c.orgId,
      status: { in: ["APPROVED", "SCHEDULED"] },
      ...(Array.isArray(b.ids) && b.ids.length ? { id: { in: b.ids.slice(0, 200) } } : {}),
      ...(b.clientId ? { clientId: b.clientId } : {}),
    },
    select: { id: true },
  });
  const sent = await notifyReadyForPublishing(c.orgId, rows.map((r) => r.id), c.name, "validation notice re-sent");
  return NextResponse.json({ success: true, data: { posts: rows.length, sent } });
}
