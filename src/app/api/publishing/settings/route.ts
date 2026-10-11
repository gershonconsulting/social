export const runtime = "edge";
/**
 * /api/publishing/settings — publishing settings + the live LinkedIn/X connection.
 * GET → { settings, publisher, live, counts }    PUT { enabled?, longPostsX?, graceMinutes?, alertEmail? }
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { getPublisherState, getSettings, liveStatus, saveSettings, type PublishSettings } from "@/lib/publishing";

async function payload(orgId: string) {
  const [settings, publisher, waiting] = await Promise.all([
    getSettings(orgId),
    getPublisherState(orgId),
    prisma.scheduledPost.count({ where: { organizationId: orgId, status: "SCHEDULED" } }),
  ]);
  return { settings, publisher, live: liveStatus(publisher), waiting };
}

export async function GET() {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  return NextResponse.json({ success: true, data: { ...(await payload(c.orgId)), canWrite: c.canWrite } });
}

export async function PUT(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = ((await req.json().catch(() => null)) || {}) as Partial<PublishSettings>;
  const patch: Partial<PublishSettings> = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (typeof b.longPostsX === "boolean") patch.longPostsX = b.longPostsX;
  if (b.graceMinutes !== undefined) patch.graceMinutes = Number(b.graceMinutes);
  if (b.alertEmail !== undefined) patch.alertEmail = b.alertEmail || null;
  if (typeof b.requireImage === "boolean") patch.requireImage = b.requireImage;
  await saveSettings(c.orgId, patch);
  return NextResponse.json({ success: true, data: { ...(await payload(c.orgId)), canWrite: c.canWrite } });
}
