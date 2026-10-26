/**
 * Every email the Publish platform sends — numbered, branded, with direct links.
 *
 * Olivier, 2026-10-26: "The title should be coming from publish.gershon.ai so
 * we know where it is coming from. Make sure that all emails do have a number
 * so we know which platform is being sent from. And make sure that we have
 * direct links to access the platform to go ahead and validate this content.
 * We have two types of emails: the one for clients and the one for internal."
 *
 * So, for every Publish email:
 *   - From:     "GC Publish · publish.gershon.ai"           (internal)
 *               "Gershon Consulting · publish.gershon.ai"   (clients)
 *               address publish@gershon.ai, replies go to social@gershonconsulting.com
 *   - Subject:  starts with its number, e.g. "[PUB-201] Content inventory: …"
 *               PUB = the Publish platform; 1xx = client emails, 2xx = internal.
 *   - Body:     a header line and a footer naming publish.gershon.ai, the
 *               number and the audience, plus a direct link into the platform.
 *   - Links:    always https://publish.gershon.ai (never social.gershon.ai),
 *               opened on the right client (?client=) and post (?item=).
 *
 * This file is IDENTICAL in gershonconsulting/social and gershonconsulting/publish
 * (the Publishing code still runs from Social's scheduled jobs until the
 * cutover) — change both together. The catalogue is docs/PUBLISH-EMAILS.md.
 */

export const PUBLISH_HOST = "publish.gershon.ai";
export const PUBLISH_ORIGIN = `https://${PUBLISH_HOST}`;
export const PUBLISH_FROM_ADDRESS = "publish@gershon.ai"; // gershon.ai is the verified Resend domain
export const PUBLISH_REPLY_TO = "social@gershonconsulting.com";

export type MailAudience = "client" | "internal";

type MailDef = { no: string; audience: MailAudience; title: string };

/** The catalogue. Never reuse or renumber a code — add new ones at the end of their range. */
export const PUBLISH_MAILS = {
  // ── 1xx: to the client's reviewer ─────────────────────────────────────────
  REVIEW_ONE: { no: "PUB-101", audience: "client", title: "New post to review" },
  REVIEW_BATCH: { no: "PUB-102", audience: "client", title: "Batch of posts to review" },
  AUTOPILOT_MONTH: { no: "PUB-103", audience: "client", title: "Autopilot month to validate" },
  REVIEW_REMINDER: { no: "PUB-104", audience: "client", title: "Reminder: posts waiting for approval" },
  NEW_VERSION: { no: "PUB-105", audience: "client", title: "New version of your post" },
  TEAM_REPLY: { no: "PUB-106", audience: "client", title: "New reply on your post review" },
  // ── 2xx: to the Gershon team ──────────────────────────────────────────────
  INVENTORY: { no: "PUB-201", audience: "internal", title: "Content inventory (daily)" },
  READY_FOR_PUBLISHING: { no: "PUB-202", audience: "internal", title: "Validated — ready for publishing" },
  CLIENT_COMMENTED: { no: "PUB-203", audience: "internal", title: "Client commented on a post" },
  CLIENT_CHANGES: { no: "PUB-204", audience: "internal", title: "Client asked for changes" },
  POST_MISSED: { no: "PUB-205", audience: "internal", title: "Scheduled post did not go out" },
  POST_STUCK: { no: "PUB-206", audience: "internal", title: "Post may not have gone out" },
  POST_FAILED_BROWSER: { no: "PUB-207", audience: "internal", title: "Post failed to publish (Chrome extension)" },
  POST_FAILED_ACCOUNT: { no: "PUB-208", audience: "internal", title: "Post failed to publish (connected account)" },
  SIGNED_OUT: { no: "PUB-209", audience: "internal", title: "Network signed out — posts on hold" },
  AUTOPILOT_REWROTE: { no: "PUB-210", audience: "internal", title: "Autopilot rewrote posts from comments" },
  AUTOPILOT_SCHEDULE_FAILED: { no: "PUB-211", audience: "internal", title: "Autopilot could not schedule posts" },
  // A validation email (1xx) that goes to the team because the company has no
  // reviewer is re-labelled internal at send time, keeping its number.
} as const satisfies Record<string, MailDef>;

export type PubMail = keyof typeof PUBLISH_MAILS;

/** A page of publish.gershon.ai, opened on a client and/or a post. */
export function publishLink(path = "/publishing", opts: { client?: string | null; item?: string | null } = {}): string {
  const u = new URL(path, PUBLISH_ORIGIN);
  if (opts.client) u.searchParams.set("client", opts.client);
  if (opts.item) u.searchParams.set("item", opts.item);
  return u.toString();
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

export function publishFrom(audience: MailAudience): string {
  const override = (process.env.PUBLISH_MAIL_FROM || "").trim();
  const address = override || PUBLISH_FROM_ADDRESS;
  const name = audience === "internal" ? `GC Publish · ${PUBLISH_HOST}` : `Gershon Consulting · ${PUBLISH_HOST}`;
  return `"${name}" <${address}>`;
}

export function numberedSubject(mail: PubMail, subject: string): string {
  const no = PUBLISH_MAILS[mail].no;
  return subject.startsWith(`[${no}]`) ? subject : `[${no}] ${subject}`;
}

/** Wraps a body in the Publish header + footer and the direct-link button. */
export function publishHtml(
  mail: PubMail,
  audience: MailAudience,
  html: string,
  cta?: { href: string; label: string } | null,
): string {
  const def = PUBLISH_MAILS[mail];
  const link = `<a href="${PUBLISH_ORIGIN}" style="color:#b91c1c;text-decoration:none;font-weight:bold">${PUBLISH_HOST}</a>`;
  const kind = audience === "internal" ? "Internal" : "Client";
  const header = `<div style="font-size:12px;color:#777;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:14px">
      <b style="color:#111">Publish</b> · ${link} · Email <b style="color:#111">${def.no}</b> · ${kind}</div>`;
  const button = cta
    ? `<p style="margin:18px 0"><a href="${cta.href}" style="display:inline-block;background:#b91c1c;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${escHtml(cta.label)} →</a></p>
       <p style="font-size:12px;color:#777;margin-top:-8px">Direct link: <a href="${cta.href}" style="color:#555">${escHtml(cta.href)}</a></p>`
    : "";
  const footer = `<div style="font-size:11px;color:#999;border-top:1px solid #eee;padding-top:8px;margin-top:20px">
      ${def.no} · ${escHtml(def.title)} — sent by Publish (${link}) for Gershon Consulting.
      ${audience === "internal" ? `Internal email. <a href="${PUBLISH_ORIGIN}/publishing" style="color:#999">Open Publish</a>` : "Questions? Just reply to this email."}</div>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${header}${html}${button}${footer}</div>`;
}
