export const runtime = "edge";
/**
 * /api/publishing/content/:id/media/:mediaId (v4.38.0)
 * DELETE            remove a picture
 * PATCH { first }   make it the first picture (the one shown first on LinkedIn and X)
 * Either one on approved / with-client content makes a new version to approve.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { markChanged } from "@/lib/publishing";

type Ctx = { params: Promise<{ id: string; mediaId: string }> };

async function load(orgId: string, id: string) {
  return prisma.contentItem.findFirst({
    where: { id, organizationId: orgId },
    include: { deliveries: true, media: { select: { id: true, position: true }, orderBy: { position: "asc" } } },
  });
}

async function renumber(ids: string[]) {
  for (let i = 0; i < ids.length; i++) await prisma.contentMedia.update({ where: { id: ids[i] }, data: { position: i } });
}

async function guard(c: { orgId: string }, ctx: Ctx) {
  const { id, mediaId } = await ctx.params;
  const item = await load(c.orgId, id);
  if (!item || !item.media.some((m) => m.id === mediaId)) return { err: NextResponse.json({ success: false, error: "Not found" }, { status: 404 }) };
  if (item.deliveries.some((d) => d.status === "POSTED" || d.status === "POSTING")) {
    return { err: NextResponse.json({ success: false, error: "Already published — pictures can't change now." }, { status: 409 }) };
  }
  return { item, mediaId };
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const g = await guard(c, ctx);
  if (g.err) return g.err;
  await prisma.contentMedia.delete({ where: { id: g.mediaId } });
  await renumber(g.item.media.filter((m) => m.id !== g.mediaId).map((m) => m.id));
  if (["IN_REVIEW", "APPROVED", "SCHEDULED", "FAILED"].includes(g.item.status)) await markChanged(c.orgId, g.item.id, c.name, "Picture removed");
  return NextResponse.json({ success: true });
}

export async function PATCH(_req: NextRequest, ctx: Ctx) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const g = await guard(c, ctx);
  if (g.err) return g.err;
  if (g.item.media[0]?.id === g.mediaId) return NextResponse.json({ success: true });
  await renumber([g.mediaId, ...g.item.media.filter((m) => m.id !== g.mediaId).map((m) => m.id)]);
  if (["IN_REVIEW", "APPROVED", "SCHEDULED", "FAILED"].includes(g.item.status)) await markChanged(c.orgId, g.item.id, c.name, "Picture order changed");
  return NextResponse.json({ success: true });
}
