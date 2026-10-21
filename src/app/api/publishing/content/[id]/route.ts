export const runtime = "edge";
/**
 * /api/publishing/content/:id — one content item. (v4.37.0)
 *
 * GET    → item + thread + deliveries + the client's review link
 * PATCH  { action, ... }
 *   edit        { title?, text?, textX?, platforms?, clientId? }
 *               A wording/network change makes it a new version; approved or
 *               scheduled content goes back to DRAFT (approval covers the exact
 *               wording) and anything not yet posted is unscheduled.
 *   submit                 → IN_REVIEW, emails the client's reviewer the link
 *   approve                → APPROVED internally (team), no client review
 *   reopen                 → DRAFT
 *   schedule  { scheduledAt } approved only; LinkedIn + X at the same time
 *   post_now               approved only; goes out within ~1 minute
 *   unschedule             → APPROVED
 *   retry                  failed/missed networks → now
 *   mark_posted { platform, postUrl? }  it was posted by hand
 * DELETE                   removes it (never touches LinkedIn or X)
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import {
  MEDIA_SELECT, addEvent, getSettings, parsePlatforms, reviewToken, reviewUrl, rollUp, scheduleItem, textProblems, unscheduleItem,
  PUBLISHING_CLIENT_WHERE, notifyReadyForPublishing } from "@/lib/publishing";
import { submitForReview } from "@/lib/publishing-review";

function bad(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}
function postIdFrom(url: string | null | undefined): string | null {
  const m = (url || "").match(/\/status(?:es)?\/(\d+)|urn:li:(?:activity|share|ugcPost):(\d+)|activity-(\d+)/);
  return m ? m[1] || m[2] || m[3] : null;
}

async function load(orgId: string, id: string) {
  return prisma.contentItem.findFirst({
    where: { id, organizationId: orgId },
    include: {
      deliveries: { orderBy: { platform: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      media: { select: MEDIA_SELECT, orderBy: { position: "asc" } },
    },
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  const { id } = await ctx.params;
  const item = await load(c.orgId, id);
  if (!item) return bad("Not found", 404);
  const link = item.clientId ? reviewUrl(await reviewToken(c.orgId, item.clientId)) : null;
  return NextResponse.json({ success: true, data: { item, reviewUrl: link, canWrite: c.canWrite } });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  try {
    const { id } = await ctx.params;
    const item = await load(c.orgId, id);
    if (!item) return bad("Not found", 404);
    if (item.deliveries.some((d) => d.status === "POSTING")) return bad("It is being published right now.", 409);
    const b = ((await req.json().catch(() => null)) || {}) as Record<string, unknown>;
    const action = String(b.action || "");
    const now = new Date();
    const posted = item.deliveries.some((d) => d.status === "POSTED");

    switch (action) {
      case "edit": {
        if (posted) return bad("Already published — edit it on the network.");
        const data: Record<string, unknown> = {};
        if (typeof b.title === "string") data.title = b.title.trim() || null;
        if (typeof b.clientId === "string" || b.clientId === null) {
          if (!b.clientId) return bad("Pick a campaign or internal company first.");
          const cl = await prisma.client.findFirst({ where: { id: String(b.clientId), organizationId: c.orgId, ...PUBLISHING_CLIENT_WHERE }, select: { id: true } });
          if (!cl) return bad("Publishing is only for campaign and internal companies.");
          data.clientId = cl.id;
        }
        const text = typeof b.text === "string" ? b.text.replace(/\r\n/g, "\n").trim() : item.text;
        const textX = typeof b.textX === "string" ? b.textX.trim() || null : item.textX;
        const platforms = b.platforms !== undefined ? parsePlatforms(b.platforms).join(",") : item.platforms;
        if (!text) return bad("The post can't be empty.");
        const wordingChanged = text !== item.text || textX !== item.textX || platforms !== item.platforms;
        if (wordingChanged) {
          Object.assign(data, { text, textX, platforms, version: item.version + 1 });
          if (["IN_REVIEW", "APPROVED", "SCHEDULED", "FAILED"].includes(item.status)) {
            if (item.status === "SCHEDULED" || item.status === "FAILED") await unscheduleItem(c.orgId, item.id);
            Object.assign(data, { status: "DRAFT", approvedAt: null, approvedBy: null, approvedRole: null, scheduledAt: null });
          }
        }
        await prisma.contentItem.update({ where: { id: item.id }, data });
        if (wordingChanged) await addEvent(c.orgId, item.id, item.version + 1, "edited", "team", c.name, `Version ${item.version + 1}`);
        break;
      }
      case "submit": {
        const err = await submitForReview(c.orgId, item.id, c.name);
        if (err) return bad(err);
        break;
      }
      case "approve": {
        if (!["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED"].includes(item.status)) return bad("Already approved.");
        const problems = textProblems(item, await getSettings(c.orgId), item.media.length);
        if (problems.length) return bad(problems.join(" "));
        await prisma.contentItem.update({ where: { id: item.id }, data: { status: "APPROVED", approvedAt: now, approvedBy: c.name, approvedRole: "team" } });
        await addEvent(c.orgId, item.id, item.version, "approved", "team", c.name, "Approved internally");
        await notifyReadyForPublishing(c.orgId, [item.id], c.name, "approved internally");
        break;
      }
      case "reopen": {
        if (posted) return bad("Already published.");
        if (item.status === "SCHEDULED" || item.status === "FAILED") await unscheduleItem(c.orgId, item.id);
        await prisma.contentItem.update({ where: { id: item.id }, data: { status: "DRAFT", approvedAt: null, approvedBy: null, approvedRole: null, scheduledAt: null } });
        await addEvent(c.orgId, item.id, item.version, "reopened", "team", c.name);
        break;
      }
      case "schedule":
      case "post_now": {
        const when = action === "post_now" ? now : b.scheduledAt ? new Date(String(b.scheduledAt)) : null;
        if (!when || Number.isNaN(when.getTime())) return bad("Pick a date and time.");
        if (when.getTime() < now.getTime() - 2 * 60000) return bad("That time is in the past.");
        const problems = await scheduleItem(c.orgId, item.id, when);
        if (problems.length) return bad(problems.join(" "));
        await addEvent(c.orgId, item.id, item.version, "scheduled", "team", c.name, when.toISOString());
        // v4.60.0: "Post now" with a connected account goes out right away through the API.
        if (action === "post_now") {
          try { const { apiPublishDue } = await import("@/lib/linked-publish"); await apiPublishDue(c.orgId); } catch { /* the extension / sweep takes it */ }
        }
        break;
      }
      case "unschedule":
        if (item.status !== "SCHEDULED") return bad("It isn't scheduled.");
        await unscheduleItem(c.orgId, item.id);
        break;
      case "retry": {
        const r = await prisma.scheduledPost.updateMany({
          where: { contentId: item.id, status: { in: ["FAILED", "MISSED"] } },
          data: { status: "SCHEDULED", scheduledAt: now, attempts: 0, lastError: null, claimedAt: null, alertedAt: null },
        });
        if (!r.count) return bad("Nothing to retry.");
        await prisma.contentItem.update({ where: { id: item.id }, data: { status: "SCHEDULED" } });
        try { const { apiPublishDue } = await import("@/lib/linked-publish"); await apiPublishDue(c.orgId); } catch { /* extension / sweep */ }
        break;
      }
      case "mark_posted": {
        const platform = String(b.platform || "");
        const d = item.deliveries.find((x) => x.platform === platform);
        if (!d) return bad("That network isn't part of this post.");
        const url = String(b.postUrl || "").trim() || null;
        await prisma.scheduledPost.update({
          where: { id: d.id },
          data: {
            status: "POSTED", postedAt: d.postedAt ?? now, postUrl: url ?? d.postUrl, externalPostId: postIdFrom(url) ?? d.externalPostId,
            verifiedAt: url ? now : d.verifiedAt, verifiedVia: url ? "manual" : d.verifiedVia, lastError: null,
          },
        });
        await rollUp(item.id);
        break;
      }
      default:
        return bad("Unknown action.");
    }
    return NextResponse.json({ success: true, data: await load(c.orgId, item.id) });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const { id } = await ctx.params;
  const item = await load(c.orgId, id);
  if (!item) return bad("Not found", 404);
  if (item.deliveries.some((d) => d.status === "POSTING")) return bad("It is being published right now.", 409);
  await prisma.contentItem.delete({ where: { id: item.id } });
  return NextResponse.json({ success: true });
}
