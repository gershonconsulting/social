export const runtime = "edge";
/**
 * /api/extension/publish/due — hand the publishing browser its next delivery.
 * (v4.37.0, extension 0.15.0)
 *
 * GET (extension token) ?skip=TWITTER,LINKEDIN   (networks this browser is signed out of)
 *   → { enabled, post: { id, platform, target, text, scheduledAt, media: [{url,mime,name}] } | null }
 *
 * One delivery per call, CLAIMED atomically (SCHEDULED → POSTING), so nothing
 * is published twice even with two browsers. The extension loops until it
 * gets null, so LinkedIn and X go out back to back.
 */
import { NextRequest, NextResponse } from "next/server";
import { deliveryScope, resolvePublishCaller } from "@/lib/publish-caller";
import prisma from "@/lib/db-raw";
import { getPublisherState, getSettings, savePublisherState, sweep } from "@/lib/publishing";

function parseMedia(j: string | null): { url: string; mime: string; name: string }[] {
  if (!j) return [];
  try {
    const a = JSON.parse(j);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    // A client's own browser (gp_ key) only ever sees that company's posts;
    // the workspace browser never sees companies set to publish on their own. (v4.42.0)
    const caller = await resolvePublishCaller(req);
    if (!caller.ok) {
      return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
    }
    const orgId = caller.orgId;
    const st = await getPublisherState(orgId, caller.clientId);
    st.lastSeenAt = new Date().toISOString();
    await savePublisherState(orgId, st, caller.clientId);
    await sweep(orgId).catch(() => null);
    const settings = await getSettings(orgId);
    if (!settings.enabled) return NextResponse.json({ success: true, data: { enabled: false, post: null } });

    const skip = (new URL(req.url).searchParams.get("skip") || "").split(",").filter(Boolean);
    const now = Date.now();
    const candidates = await prisma.scheduledPost.findMany({
      where: {
        ...(await deliveryScope(orgId, caller.clientId)),
        status: "SCHEDULED",
        platform: skip.length ? { notIn: skip } : undefined,
        scheduledAt: { lte: new Date(now), gte: new Date(now - settings.graceMinutes * 60000) },
      },
      orderBy: [{ scheduledAt: "asc" }, { platform: "asc" }],
      take: 5,
    });
    // v4.60.0: posts of a company with a connected account go through the API, not this browser.
    const { apiRouted } = await import("@/lib/linked-publish");
    const linkedCache = new Map();
    for (const d of candidates) {
      if (await apiRouted(orgId, d, linkedCache)) continue;
      const claimed = await prisma.scheduledPost.updateMany({
        where: { id: d.id, status: "SCHEDULED" },
        data: { status: "POSTING", claimedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claimed.count === 1) {
        return NextResponse.json({
          success: true,
          data: {
            enabled: true,
            post: { id: d.id, platform: d.platform, target: d.target, text: d.text, scheduledAt: d.scheduledAt, media: parseMedia(d.mediaJson) },
          },
        });
      }
    }
    return NextResponse.json({ success: true, data: { enabled: true, post: null } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
