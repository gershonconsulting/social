export const runtime = "edge";
/**
 * GET /api/connect/:key — what a client's connect page shows (v4.42.0).
 * Public: the publishing key in the path is the access. Answers only the
 * company name, its accounts and whether its browser has checked in.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { getPublisherState, getTarget, liveStatus, resolvePublishKey } from "@/lib/publishing";
import { EXTENSION_LATEST } from "@/lib/extension-version";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const r = await resolvePublishKey(key);
  if (!r) return NextResponse.json({ success: false, error: "This link is not valid any more. Ask Gershon Consulting for a new one." }, { status: 404 });
  const [client, t, st] = await Promise.all([
    prisma.client.findFirst({ where: { id: r.clientId }, select: { name: true, logoUrl: true } }),
    getTarget(r.orgId, r.clientId),
    getPublisherState(r.orgId, r.clientId),
  ]);
  return NextResponse.json(
    {
      success: true,
      data: {
        client: client?.name || "",
        logoUrl: client?.logoUrl || null,
        linkedinUrl: t.linkedinUrl,
        xHandle: t.xHandle,
        latest: EXTENSION_LATEST,
        live: liveStatus(st),
        lastSeenAt: st.lastSeenAt,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
