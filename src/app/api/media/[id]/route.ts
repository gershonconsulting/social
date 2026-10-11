export const runtime = "edge";
/**
 * GET /api/media/:id?k=<key> — a post's picture (v4.38.0).
 *
 * Public on purpose: the client review page (no account) and the Chrome
 * extension load pictures from here. The random 32-hex key in the URL is the
 * access; without the right key it is a 404. Pictures never change once
 * uploaded (a change is a new picture), so they cache forever.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const k = new URL(req.url).searchParams.get("k") || "";
  if (!/^[a-f0-9]{32}$/.test(k)) return new NextResponse("Not found", { status: 404 });
  const m = await prisma.contentMedia.findFirst({ where: { id, key: k }, select: { mime: true, dataB64: true, name: true } });
  if (!m) return new NextResponse("Not found", { status: 404 });
  const bin = atob(m.dataB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new NextResponse(bytes, {
    headers: {
      "content-type": m.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `inline; filename="${(m.name || "picture.jpg").replace(/[^\w.\-]+/g, "_")}"`,
      "access-control-allow-origin": "*",
    },
  });
}
