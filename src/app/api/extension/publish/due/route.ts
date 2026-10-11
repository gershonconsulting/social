export const runtime = "edge";
/**
 * /api/extension/publish/due — hand the publishing browser its next delivery.
 * (v4.37.0, extension 0.15.0)
 *
 * GET (extension token) ?skip=TWITTER,LINKEDIN   (networks this browser is signed out of)
 *   → { enabled, post: { id, platform, target, text, scheduledAt } | null }
 *
 * One delivery per call, CLAIMED atomically (SCHEDULED → POSTING), so nothing
 * is published twice even with two browsers. The extension loops until it
 * gets null, so LinkedIn and X go out back to back.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionCaller } from "@/lib/extension-auth";
import prisma from "@/lib/db-raw";
import { getPublisherState, getSettings, savePublisherState, sweep } from "@/lib/publishing";

export async function GET(req: NextRequest) {
  try {
    const caller = await resolveExtensionCaller(req);
    if (!caller.ok) {
      return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
    }
    const orgId = caller.orgId;
    const st = await getPublisherState(orgId);
    st.lastSeenAt = new Date().toISOString();
    await savePublisherState(orgId, st);
    await sweep(orgId).catch(() => null);
    const settings = await getSettings(orgId);
    if (!settings.enabled) return NextResponse.json({ success: true, data: { enabled: false, post: null } });

    const skip = (new URL(req.url).searchParams.get("skip") || "").split(",").filter(Boolean);
    const now = Date.now();
    const candidates = await prisma.scheduledPost.findMany({
      where: {
        organizationId: orgId,
        status: "SCHEDULED",
        platform: skip.length ? { notIn: skip } : undefined,
        scheduledAt: { lte: new Date(now), gte: new Date(now - settings.graceMinutes * 60000) },
      },
      orderBy: [{ scheduledAt: "asc" }, { platform: "asc" }],
      take: 5,
    });
    for (const d of candidates) {
      const claimed = await prisma.scheduledPost.updateMany({
        where: { id: d.id, status: "SCHEDULED" },
        data: { status: "POSTING", claimedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claimed.count === 1) {
        return NextResponse.json({
          success: true,
          data: { enabled: true, post: { id: d.id, platform: d.platform, target: d.target, text: d.text, scheduledAt: d.scheduledAt } },
        });
      }
    }
    return NextResponse.json({ success: true, data: { enabled: true, post: null } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
