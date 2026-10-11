/**
 * The copywriter ↔ client review loop (v4.37.0, CloudCampaign-style).
 *
 * Team side: submitForReview() sends an item to the client and emails the
 * client's reviewer their private link. Client side (no account, just the
 * link): clientAction() comments, requests changes or approves — each one is
 * written to the item's thread and emailed to the team.
 */
import prisma from "@/lib/db-raw";
import {
  addEvent, alertTeam, mediaCount, esc, getSettings, getTarget, quote, reviewToken, reviewUrl, sendMail, textProblems, SITE,
} from "@/lib/publishing";

export async function submitForReview(orgId: string, itemId: string, by: string): Promise<string | null> {
  const item = await prisma.contentItem.findFirst({ where: { id: itemId, organizationId: orgId } });
  if (!item) return "Content not found.";
  if (!item.clientId) return "Pick the client first — the review goes to their reviewer.";
  if (!["DRAFT", "CHANGES_REQUESTED", "IN_REVIEW"].includes(item.status)) return "This content is already approved.";
  const problems = textProblems(item, await getSettings(orgId), await mediaCount(item.id));
  if (problems.length) return problems.join(" ");

  await prisma.contentItem.update({ where: { id: item.id }, data: { status: "IN_REVIEW", submittedAt: new Date() } });
  await addEvent(orgId, item.id, item.version, "submitted", "team", by);

  const target = await getTarget(orgId, item.clientId);
  const token = await reviewToken(orgId, item.clientId);
  if (target.reviewerEmail) {
    const client = await prisma.client.findFirst({ where: { id: item.clientId }, select: { name: true } });
    const hi = target.reviewerName ? `Hi ${esc(target.reviewerName.split(/\s+/)[0])},` : "Hello,";
    await sendMail(
      target.reviewerEmail,
      `New post to review${client?.name ? " — " + client.name : ""}`,
      `<p>${hi}</p><p>A new post is ready for your review${item.version > 1 ? ` (version ${item.version})` : ""}:</p>${quote(item.text)}
       <p>You can comment, ask for changes, or approve it — nothing is published before you approve.</p>`,
      { href: reviewUrl(token), label: "Review the post" },
    );
  }
  return null;
}

export type ClientAction = "comment" | "request_changes" | "approve";

export async function clientAction(
  orgId: string,
  clientId: string,
  itemId: string,
  action: ClientAction,
  name: string | null,
  body: string | null,
): Promise<string | null> {
  const item = await prisma.contentItem.findFirst({ where: { id: itemId, organizationId: orgId, clientId } });
  if (!item) return "Post not found.";
  const who = (name || "").trim().slice(0, 80) || "Client";
  const text = (body || "").trim();
  const client = await prisma.client.findFirst({ where: { id: clientId }, select: { name: true } });
  const label = client?.name || "The client";

  if (action === "comment") {
    if (!text) return "Write a comment first.";
    await addEvent(orgId, item.id, item.version, "comment", "client", who, text);
    await alertTeam(orgId, `${label} commented on a post`, `<p><b>${esc(who)}</b> (${esc(label)}) wrote:</p>${quote(text)}<p>On:</p>${quote(item.text)}`);
    return null;
  }
  if (action === "request_changes") {
    if (item.status !== "IN_REVIEW") return "This post isn't waiting for your review.";
    if (!text) return "Tell the copywriter what to change.";
    await prisma.contentItem.update({ where: { id: item.id }, data: { status: "CHANGES_REQUESTED" } });
    await addEvent(orgId, item.id, item.version, "changes_requested", "client", who, text);
    await alertTeam(orgId, `${label} asked for changes`, `<p><b>${esc(who)}</b> (${esc(label)}) asked for changes:</p>${quote(text)}<p>On:</p>${quote(item.text)}`);
    return null;
  }
  if (action === "approve") {
    if (item.status !== "IN_REVIEW") return "This post isn't waiting for your review.";
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: who, approvedRole: "client" },
    });
    await addEvent(orgId, item.id, item.version, "approved", "client", who, text || null);
    await alertTeam(
      orgId,
      `${label} approved a post — ready to schedule`,
      `<p><b>${esc(who)}</b> (${esc(label)}) approved:</p>${quote(item.text)}${text ? `<p>Note: ${esc(text)}</p>` : ""}`,
      `${SITE}/publishing`,
    );
    return null;
  }
  return "Unknown action.";
}
