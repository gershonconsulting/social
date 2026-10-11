export const runtime = "edge";
/**
 * POST /api/publishing/content/:id/media — add a picture to a post. (v4.38.0)
 *
 * Body: { dataB64, mime, name?, width?, height? }. The page resizes the
 * picture to ≤ 2048 px JPEG before sending it, so a picture is a few hundred
 * KB. At most 4 per post (X's limit), 5 MB each.
 *
 * Adding a picture to something already with the client, approved or
 * scheduled makes it a new version that needs approving again.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { IMAGE_MIMES, MAX_IMAGES, MAX_IMAGE_BYTES, MEDIA_SELECT, markChanged, mediaUrl } from "@/lib/publishing";

function key(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  try {
    const { id } = await ctx.params;
    const item = await prisma.contentItem.findFirst({ where: { id, organizationId: c.orgId }, include: { deliveries: true } });
    if (!item) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    if (item.deliveries.some((d) => d.status === "POSTED" || d.status === "POSTING")) {
      return NextResponse.json({ success: false, error: "Already published — pictures can't change now." }, { status: 409 });
    }
    const b = (await req.json().catch(() => null)) as
      | { dataB64?: string; mime?: string; name?: string; width?: number; height?: number }
      | null;
    const mime = (b?.mime || "").toLowerCase();
    const data = (b?.dataB64 || "").replace(/^data:[^,]+,/, "");
    if (!IMAGE_MIMES.includes(mime)) return NextResponse.json({ success: false, error: "Use a JPEG, PNG or GIF picture." }, { status: 400 });
    if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) return NextResponse.json({ success: false, error: "The picture is empty." }, { status: 400 });
    const size = Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (size > MAX_IMAGE_BYTES) return NextResponse.json({ success: false, error: "The picture is over 5 MB." }, { status: 400 });

    const count = await prisma.contentMedia.count({ where: { contentId: item.id } });
    if (count >= MAX_IMAGES) return NextResponse.json({ success: false, error: `At most ${MAX_IMAGES} pictures per post.` }, { status: 400 });

    const m = await prisma.contentMedia.create({
      data: {
        organizationId: c.orgId,
        contentId: item.id,
        key: key(),
        position: count,
        mime,
        name: (b?.name || "").slice(0, 120) || null,
        width: Number.isFinite(b?.width) ? Math.round(b!.width!) : null,
        height: Number.isFinite(b?.height) ? Math.round(b!.height!) : null,
        sizeBytes: size,
        dataB64: data,
      },
      select: MEDIA_SELECT,
    });
    if (["IN_REVIEW", "APPROVED", "SCHEDULED", "FAILED"].includes(item.status)) {
      await markChanged(c.orgId, item.id, c.name, "Picture added");
    }
    return NextResponse.json({ success: true, data: { ...m, url: mediaUrl(m) } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
