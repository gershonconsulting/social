export const runtime = "edge";
/**
 * /api/extension/publish/result — what happened when the browser published.
 * (v4.37.0, extension 0.15.0)
 *
 * POST (extension token) { id, outcome, postUrl?, error? }
 *   "posted"              clicked Post AND found it on the page/profile → POSTED, verified
 *   "clicked_unconfirmed" clicked Post, not visible yet → POSTED, confirmed later
 *                         by the collection. Never retried.
 *   "failed_before_click" nothing reached the network → retried (3 tries), then FAILED
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveExtensionCaller } from "@/lib/extension-auth";
import prisma from "@/lib/db-raw";
import {
  MAX_ATTEMPTS, NET_LABEL, addEvent, alertTeam, esc, getPublisherState, quote, rollUp, savePublisherState, SITE, type Net,
} from "@/lib/publishing";

function postIdFrom(url: string | null | undefined): string | null {
  const m = (url || "").match(/\/status(?:es)?\/(\d+)|urn:li:(?:activity|share|ugcPost):(\d+)|activity-(\d+)/);
  return m ? m[1] || m[2] || m[3] : null;
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolveExtensionCaller(req);
    if (!caller.ok) {
      return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
    }
    const b = (await req.json().catch(() => null)) as { id?: string; outcome?: string; postUrl?: string | null; error?: string | null } | null;
    if (!b?.id) return NextResponse.json({ success: false, error: "id required" }, { status: 400 });
    const d = await prisma.scheduledPost.findFirst({ where: { id: b.id, organizationId: caller.orgId } });
    if (!d) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

    const now = new Date();
    const error = (b.error || "").slice(0, 500) || null;
    const st = await getPublisherState(caller.orgId);
    let status: string;

    if (b.outcome === "posted" || b.outcome === "clicked_unconfirmed") {
      const ok = b.outcome === "posted" && !!b.postUrl;
      await prisma.scheduledPost.update({
        where: { id: d.id },
        data: {
          status: "POSTED", postedAt: now, postUrl: b.postUrl || null, externalPostId: postIdFrom(b.postUrl),
          verifiedAt: ok ? now : null, verifiedVia: ok ? "extension" : null,
          lastError: ok ? null : "Published; waiting for confirmation on the page.",
        },
      });
      st.lastPostAt = now.toISOString();
      st.lastError = null;
      status = "POSTED";
    } else {
      const giveUp = d.attempts >= MAX_ATTEMPTS;
      status = giveUp ? "FAILED" : "SCHEDULED";
      await prisma.scheduledPost.update({
        where: { id: d.id },
        data: { status, claimedAt: null, lastError: error || "Publishing failed before posting.", alertedAt: giveUp ? now : null },
      });
      st.lastError = error;
      if (giveUp) {
        await alertTeam(
          caller.orgId,
          `A ${NET_LABEL[d.platform as Net] ?? d.platform} post failed to publish`,
          `<p>After ${d.attempts} tries this post could not be published on ${NET_LABEL[d.platform as Net] ?? d.platform}.</p>${quote(d.text)}
           <p>Reason: ${esc(error || "unknown")}</p><p>Nothing was posted. Fix the cause, then press Retry.</p>`,
          `${SITE}/publishing/calendar`,
        );
      }
    }
    await savePublisherState(caller.orgId, st);
    if (d.contentId) {
      await rollUp(d.contentId);
      if (status === "FAILED") {
        const item = await prisma.contentItem.findUnique({ where: { id: d.contentId }, select: { version: true } });
        await addEvent(caller.orgId, d.contentId, item?.version ?? 1, "failed", "team", "Social", `${NET_LABEL[d.platform as Net] ?? d.platform}: ${error || "failed"}`);
      }
    }
    return NextResponse.json({ success: true, data: { status } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
