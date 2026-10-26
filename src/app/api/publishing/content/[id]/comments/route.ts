export const runtime = "edge";
/**
 * POST /api/publishing/content/:id/comments { body, revise? } — the team's side of the review thread. (v4.37.0)
 * v4.55.0: the comment also writes a new version of the post (unless revise === false).
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { addEvent, esc, getTarget, quote, reviewToken, reviewUrl, sendMail } from "@/lib/publishing";
import { reviseFromComment, type ReviseResult } from "@/lib/publishing-revise";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const { id } = await ctx.params;
  const item = await prisma.contentItem.findFirst({ where: { id, organizationId: c.orgId } });
  if (!item) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { body?: string; notifyClient?: boolean; revise?: boolean } | null;
  const body = (b?.body || "").trim();
  if (!body) return NextResponse.json({ success: false, error: "Write a comment first." }, { status: 400 });
  await addEvent(c.orgId, item.id, item.version, "comment", "team", c.name, body);
  const revised: ReviseResult | null = b?.revise === false ? null : await reviseFromComment(c.orgId, item.id, body, { role: "team", name: c.name });
  // Reply reaches the client by email while the item is with them.
  if (item.clientId && b?.notifyClient !== false && ["IN_REVIEW", "CHANGES_REQUESTED"].includes(item.status)) {
    const t = await getTarget(c.orgId, item.clientId);
    if (t.reviewerEmail) {
      const href = reviewUrl(await reviewToken(c.orgId, item.clientId));
      if (revised?.revised) {
        await sendMail(
          t.reviewerEmail,
          `New version of your post (version ${revised.version})`,
          `<p><b>${esc(c.name || "Your copywriter")}</b> wrote:</p>${quote(body)}<p>Here is the new version, ready for your review:</p>${quote(revised.text)}`,
          { href, label: "Review the new version" },
          "NEW_VERSION",
        );
      } else {
        await sendMail(
          t.reviewerEmail,
          "New reply on your post review",
          `<p><b>${esc(c.name || "Your copywriter")}</b> replied:</p>${quote(body)}<p>On:</p>${quote(item.text)}`,
          { href, label: "Open the review" },
          "TEAM_REPLY",
        );
      }
    }
  }
  return NextResponse.json({ success: true, revised });
}
