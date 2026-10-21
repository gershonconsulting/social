/**
 * Server-side publishing through the connected accounts (v4.60.0).
 *
 * Runs at the start of every sweep (every minute while a publishing browser
 * polls, every 15 minutes from the cron) and right after "Post now". A due
 * delivery whose company has a Linked Account matching the delivery's target
 * is claimed (SCHEDULED → POSTING, exactly like the extension does), posted
 * through the LinkedIn / X API, and closed with the post's direct link.
 *
 * Failures BEFORE the network accepted the post go back to SCHEDULED (the
 * extension may then try, up to MAX_ATTEMPTS); an answer that leaves it
 * unclear whether the post exists is FAILED with no retry — never a double post.
 */
import prisma from "@/lib/db-raw";
import {
  MAX_ATTEMPTS, NET_LABEL, addEvent, alertTeam, esc, getSettings, quote, rollUp, SITE, type Net,
} from "@/lib/publishing";
import {
  getLinked, saveLinked, linkedinPost, linkedinToken, liMatches, xMatches, xPost, xTokenFresh, type Linked,
} from "@/lib/linked-accounts";

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function picture(contentId: string | null): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null> {
  if (!contentId) return null;
  const m = await prisma.contentMedia.findFirst({ where: { contentId }, orderBy: { position: "asc" }, select: { dataB64: true, mime: true } });
  return m?.dataB64 ? { bytes: unb64(m.dataB64), mime: m.mime || "image/jpeg" } : null;
}

/** Does this delivery go through a Linked Account? (used by the extension's /due to leave it alone) */
export async function apiRouted(orgId: string, d: { clientId: string | null; platform: string; target: string | null }, cache?: Map<string, Linked>): Promise<boolean> {
  if (!d.clientId) return false;
  let l = cache?.get(d.clientId);
  if (!l) {
    l = await getLinked(orgId, d.clientId);
    cache?.set(d.clientId, l);
  }
  return d.platform === "LINKEDIN" ? liMatches(l.linkedin, d.target) : d.platform === "TWITTER" ? xMatches(l.x, d.target) : false;
}

export async function apiPublishDue(orgId: string): Promise<{ posted: number; failed: number }> {
  const settings = await getSettings(orgId);
  if (!settings.enabled) return { posted: 0, failed: 0 };
  const now = Date.now();
  const due = await prisma.scheduledPost.findMany({
    where: { organizationId: orgId, status: "SCHEDULED", scheduledAt: { lte: new Date(now), gte: new Date(now - settings.graceMinutes * 60000) } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });
  let posted = 0, failed = 0;
  const cache = new Map<string, Linked>();
  for (const d of due) {
    if (!(await apiRouted(orgId, d, cache))) continue;
    const claimed = await prisma.scheduledPost.updateMany({
      where: { id: d.id, status: "SCHEDULED" },
      data: { status: "POSTING", claimedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    const l = cache.get(d.clientId as string) as Linked;
    const net = d.platform as Net;
    try {
      const pic = await picture(d.contentId);
      let res: { url: string; id: string };
      if (net === "LINKEDIN") {
        const { token, updated } = await linkedinToken(l.linkedin!);
        if (updated) { l.linkedin = updated; await saveLinked(orgId, d.clientId!, l); }
        res = await linkedinPost(l.linkedin!, token, d.text, pic);
      } else {
        const { token, updated } = await xTokenFresh(l.x!);
        if (updated) { l.x = updated; await saveLinked(orgId, d.clientId!, l); }
        res = await xPost(l.x!, token, d.text, pic);
      }
      const at = new Date();
      await prisma.scheduledPost.update({
        where: { id: d.id },
        data: {
          status: "POSTED", postedAt: at, postUrl: res.url || null, externalPostId: res.id.split(":").pop() || res.id,
          verifiedAt: at, verifiedVia: "api", lastError: null,
        },
      });
      posted++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const unclear = !!(e as { sent?: boolean })?.sent;
      const giveUp = unclear || d.attempts + 1 >= MAX_ATTEMPTS;
      await prisma.scheduledPost.update({
        where: { id: d.id },
        data: {
          status: giveUp ? "FAILED" : "SCHEDULED", claimedAt: null, alertedAt: giveUp ? new Date() : null,
          lastError: unclear ? `${msg} — check the network before retrying, it may have gone out.` : msg,
        },
      });
      if (l && d.clientId) {
        if (net === "LINKEDIN" && l.linkedin) l.linkedin.lastError = msg;
        if (net === "TWITTER" && l.x) l.x.lastError = msg;
        await saveLinked(orgId, d.clientId, l);
      }
      if (giveUp) {
        failed++;
        await alertTeam(
          orgId,
          `A ${NET_LABEL[net] ?? net} post failed to publish`,
          `<p>The connected ${NET_LABEL[net] ?? net} account could not publish this post.</p>${quote(d.text)}<p>Reason: ${esc(msg)}</p>
           <p>Fix the cause (Settings → Linked accounts), then press Retry.</p>`,
          `${SITE}/settings#linked`,
        );
      }
    }
    if (d.contentId) {
      await rollUp(d.contentId);
      const after = await prisma.scheduledPost.findUnique({ where: { id: d.id }, select: { status: true, lastError: true } });
      if (after?.status === "FAILED") {
        const item = await prisma.contentItem.findUnique({ where: { id: d.contentId }, select: { version: true } });
        await addEvent(orgId, d.contentId, item?.version ?? 1, "failed", "team", "Social", `${NET_LABEL[net] ?? net}: ${after.lastError || "failed"}`);
      }
    }
  }
  return { posted, failed };
}
