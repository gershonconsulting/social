/**
 * Content inventory + review reminders (v4.39.0).
 *
 * RULE (Olivier, 2026-10-11): every client must always have ONE WEEK of
 * content ready to publish. "Ready" = approved (by the client or internally)
 * and not yet published — scheduled for the future or waiting for a slot.
 * The week is measured against the client's posts-per-week objective (the
 * same number the monthly reports use — Settings → Campaign objectives).
 *
 *   coverage (days) = ready ÷ (posts per week ÷ 7)
 *   ok        ≥ 7 days
 *   low       3.5 – 7 days      → amber warning
 *   critical  < 3.5 days        → red warning
 *
 * Content that is not validated is chased:
 *   - With the client > 2 days → the client's reviewer gets ONE reminder
 *     email listing everything waiting (at most every 2 days per client).
 *   - Changes requested > 1 day → flagged to the team (the copywriter owes it).
 * The team gets one daily email (only when something needs attention) with
 * the inventory warnings and the overdue reviews. Run by
 * /api/cron/publishing-daily every morning; the board shows the same live.
 */
import prisma from "@/lib/db-raw";
import { objectivesFor } from "@/lib/campaigns/objectives";
import { alertTeam, esc, getTarget, quote, reviewToken, reviewUrl, sendMail, SITE, PUBLISHING_CLIENT_WHERE } from "@/lib/publishing";

export const TARGET_DAYS = 7;
export const REVIEW_REMIND_AFTER_DAYS = 2;
export const CHANGES_OVERDUE_DAYS = 1;
const DAY = 86400000;

export type InventoryRow = {
  clientId: string;
  name: string;
  clientType: string;
  perWeek: number;
  /** Approved, not published yet (scheduled in the future or waiting for a slot). */
  ready: number;
  scheduled: number;
  approvedUnscheduled: number;
  coverageDays: number;
  /** Posts still needed to reach one week of ready content. */
  missing: number;
  /** The day the ready content runs out (ISO), or null when there is none. */
  runsOutOn: string | null;
  drafts: number;
  inReview: number;
  changesRequested: number;
  /** Days the oldest post has been waiting for the client. */
  oldestReviewDays: number;
  overdueReviews: number;
  overdueChanges: number;
  level: "ok" | "low" | "critical";
};

export async function inventory(orgId: string, now = Date.now()): Promise<InventoryRow[]> {
  const items = await prisma.contentItem.findMany({
    where: { organizationId: orgId, clientId: { not: null }, status: { in: ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED"] } },
    select: { clientId: true, status: true, scheduledAt: true, submittedAt: true, updatedAt: true },
  });
  // Every campaign and internal company is tracked even with an empty library
  // — an empty library is exactly the case to warn about. Nothing else appears
  // here or in its reminders (v4.39.2).
  const clients = await prisma.client.findMany({
    where: {
      organizationId: orgId,
      archivedAt: null,
      status: { not: "ARCHIVED" },
      ...PUBLISHING_CLIENT_WHERE,
    },
    select: { id: true, name: true, clientType: true },
    orderBy: { name: "asc" },
  });
  const { perWeek } = await objectivesFor(orgId, clients);

  const rows: InventoryRow[] = clients.map((c) => {
    const mine = items.filter((i) => i.clientId === c.id);
    const scheduled = mine.filter((i) => i.status === "SCHEDULED" && i.scheduledAt && i.scheduledAt.getTime() >= now).length;
    const approvedUnscheduled = mine.filter((i) => i.status === "APPROVED").length;
    const ready = scheduled + approvedUnscheduled;
    const pw = perWeek(c.id);
    const coverageDays = pw > 0 ? Math.round(((ready * 7) / pw) * 10) / 10 : 0;
    const review = mine.filter((i) => i.status === "IN_REVIEW");
    const changes = mine.filter((i) => i.status === "CHANGES_REQUESTED");
    const ageDays = (d: Date | null) => (d ? (now - d.getTime()) / DAY : 0);
    const oldestReviewDays = review.length ? Math.floor(Math.max(...review.map((i) => ageDays(i.submittedAt ?? i.updatedAt)))) : 0;
    return {
      clientId: c.id,
      name: c.name,
      clientType: c.clientType,
      perWeek: pw,
      ready,
      scheduled,
      approvedUnscheduled,
      coverageDays,
      missing: Math.max(0, Math.ceil(pw - ready)),
      runsOutOn: ready ? new Date(now + coverageDays * DAY).toISOString() : null,
      drafts: mine.filter((i) => i.status === "DRAFT").length,
      inReview: review.length,
      changesRequested: changes.length,
      oldestReviewDays,
      overdueReviews: review.filter((i) => ageDays(i.submittedAt ?? i.updatedAt) >= REVIEW_REMIND_AFTER_DAYS).length,
      overdueChanges: changes.filter((i) => ageDays(i.updatedAt) >= CHANGES_OVERDUE_DAYS).length,
      level: coverageDays >= TARGET_DAYS ? "ok" : coverageDays >= TARGET_DAYS / 2 ? "low" : "critical",
    };
  });
  // Worst first.
  const rank = { critical: 0, low: 1, ok: 2 } as const;
  return rows.sort((a, b) => rank[a.level] - rank[b.level] || a.coverageDays - b.coverageDays || a.name.localeCompare(b.name));
}

async function getStamp(orgId: string, key: string): Promise<string | null> {
  const r = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } });
  return r?.value ?? null;
}
async function setStamp(orgId: string, key: string, value: string): Promise<void> {
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value },
    update: { value },
  });
}

/** Remind each client's reviewer about posts waiting > 2 days. At most once every 2 days per client. */
export async function remindReviewers(orgId: string, now = Date.now()): Promise<{ clientId: string; to: string; count: number }[]> {
  const waiting = await prisma.contentItem.findMany({
    where: { organizationId: orgId, status: "IN_REVIEW", clientId: { not: null } },
    select: { id: true, clientId: true, text: true, submittedAt: true, updatedAt: true },
    orderBy: { submittedAt: "asc" },
  });
  const byClient = new Map<string, typeof waiting>();
  for (const w of waiting) {
    if (now - (w.submittedAt ?? w.updatedAt).getTime() < REVIEW_REMIND_AFTER_DAYS * DAY) continue;
    if (!byClient.has(w.clientId!)) byClient.set(w.clientId!, []);
    byClient.get(w.clientId!)!.push(w);
  }
  const sent: { clientId: string; to: string; count: number }[] = [];
  for (const [clientId, list] of byClient) {
    const key = `review_reminder:${clientId}`;
    const last = await getStamp(orgId, key);
    if (last && now - Date.parse(last) < REVIEW_REMIND_AFTER_DAYS * DAY - 3600000) continue;
    const t = await getTarget(orgId, clientId);
    if (!t.reviewerEmail) continue;
    const allWaiting = waiting.filter((w) => w.clientId === clientId);
    const oldest = Math.floor((now - (list[0].submittedAt ?? list[0].updatedAt).getTime()) / DAY);
    const hi = t.reviewerName ? `Hi ${esc(t.reviewerName.split(/\s+/)[0])},` : "Hello,";
    const ok = await sendMail(
      t.reviewerEmail,
      `Reminder: ${allWaiting.length} post${allWaiting.length === 1 ? "" : "s"} waiting for your approval`,
      `<p>${hi}</p>
       <p>${allWaiting.length} post${allWaiting.length === 1 ? " is" : "s are"} waiting for your review — the oldest for ${oldest} days.
       To keep your publishing calendar on track we need them approved (or your changes) soon.</p>
       ${allWaiting.slice(0, 3).map((w) => quote(w.text.slice(0, 280))).join("")}
       ${allWaiting.length > 3 ? `<p>…and ${allWaiting.length - 3} more.</p>` : ""}`,
      { href: reviewUrl(await reviewToken(orgId, clientId)), label: "Review the posts" },
    );
    if (ok) {
      await setStamp(orgId, key, new Date(now).toISOString());
      sent.push({ clientId, to: t.reviewerEmail, count: allWaiting.length });
    }
  }
  return sent;
}

function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** The team's daily inventory email — only when something needs attention, once a day. */
export async function teamDigest(orgId: string, now = Date.now(), force = false): Promise<{ sent: boolean; rows: InventoryRow[] }> {
  const rows = await inventory(orgId, now);
  const attention = rows.filter((r) => r.level !== "ok" || r.overdueReviews || r.overdueChanges);
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (!attention.length) return { sent: false, rows };
  if (!force && (await getStamp(orgId, "publishing_digest_day")) === today) return { sent: false, rows };

  const color = { critical: "#b91c1c", low: "#b45309", ok: "#047857" } as const;
  const table = attention
    .map((r) => {
      const notes: string[] = [];
      if (r.level !== "ok") notes.push(`<b style="color:${color[r.level]}">${r.coverageDays} of 7 days ready</b> — ${r.missing} more approved post${r.missing === 1 ? "" : "s"} needed`);
      if (r.overdueReviews) notes.push(`${r.overdueReviews} waiting for the client for ${days(r.oldestReviewDays)}+`);
      if (r.overdueChanges) notes.push(`${r.overdueChanges} with changes requested, not yet revised`);
      if (r.drafts) notes.push(`${r.drafts} draft${r.drafts === 1 ? "" : "s"} not sent for review`);
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top"><b>${esc(r.name)}</b><br><span style="color:#666;font-size:12px">${r.perWeek}/week · ${r.ready} ready</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${notes.join("<br>")}</td></tr>`;
    })
    .join("");
  const critical = attention.filter((r) => r.level === "critical").length;
  const sent = await alertTeam(
    orgId,
    critical
      ? `Content inventory: ${critical} client${critical === 1 ? " is" : "s are"} under half a week`
      : `Content inventory: ${attention.length} client${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} attention`,
    `<p>Every client should always have <b>one week of approved content</b> ready to publish. Today:</p>
     <table style="border-collapse:collapse;font-size:14px">${table}</table>
     <p style="color:#555;font-size:13px">Clients' reviewers are reminded automatically after ${REVIEW_REMIND_AFTER_DAYS} days.</p>`,
    `${SITE}/publishing`,
  );
  if (sent) await setStamp(orgId, "publishing_digest_day", today);
  return { sent, rows };
}

/**
 * Workspaces that have started using Publishing (at least one post in the
 * library). Until a workspace moves off HeroPost its empty library is not a
 * warning, so it gets no inventory email yet.
 */
export async function orgsForInventory(): Promise<string[]> {
  const rows = await prisma.contentItem.findMany({ select: { organizationId: true }, distinct: ["organizationId"] });
  return rows.map((r) => r.organizationId).filter((x): x is string => !!x);
}
