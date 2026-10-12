/**
 * Publishing — content review + LinkedIn & X publishing. (v4.37.0)
 *
 * Replaces HeroPost (scheduling/publishing) and CloudCampaign's review loop.
 *
 * 1. WRITE & REVIEW (CloudCampaign-style). A copywriter writes a ContentItem
 *    for a client and sends it for review. The client opens their private
 *    review link (/review/<token>, no account needed), comments, asks for
 *    changes or approves. Every step is kept in the item's thread. Editing an
 *    approved text sends it back to DRAFT — approval covers the exact wording.
 *    The team can also approve internally (Gershon's own content).
 *
 * 2. SCHEDULE. An approved item gets one time; scheduling creates one delivery
 *    (ScheduledPost) per network — LinkedIn and X go out at the same time.
 *
 * 3. PUBLISH. The Social Chrome extension, in the browser signed in to
 *    LinkedIn and X, claims due deliveries one by one, posts through each
 *    network's own composer, finds the post on the page/profile and reports
 *    its URL. No password and no API key are stored.
 *
 * 4. CHECK. sweep() — run by the extension every minute, by the pages on load,
 *    and by a 15-minute GitHub Actions cron — marks deliveries that never went
 *    out (MISSED), claims that never reported back (FAILED), confirms POSTED
 *    ones against the collected posts, rolls each item up to PUBLISHED /
 *    PARTIAL / FAILED, and emails once per problem and once per sign-out.
 *
 * NEVER DOUBLE-POSTS: a delivery is retried only when the extension reports
 * it failed BEFORE clicking Post.
 */
import type { ClientType } from "@prisma/client";
import prisma from "@/lib/db-raw";
import { resolveFrom } from "@/lib/email/sender";

export const SITE = "https://social.gershoncrm.com";

/** Publishing is for CAMPAIGN companies and our own INTERNAL ones — Gershon
 *  posts for itself too (Olivier, 2026-10-12). Every
 *  company picker, the Accounts page, the content inventory, its reminders and
 *  the create/edit checks use this one filter. */
export const PUBLISHING_CLIENT_TYPES = ["CAMPAIGN", "INTERNAL"] as ClientType[];
export const PUBLISHING_CLIENT_WHERE = { clientType: { in: PUBLISHING_CLIENT_TYPES } };
export const PLATFORMS = ["LINKEDIN", "TWITTER"] as const;
export type Net = (typeof PLATFORMS)[number];
export const NET_LABEL: Record<Net, string> = { LINKEDIN: "LinkedIn", TWITTER: "X" };

export const ITEM_STATUSES = [
  "DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "PARTIAL", "FAILED",
] as const;

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_KEY = "publishing_settings";
const PUBLISHER_KEY = "publisher_state";

export type PublishSettings = {
  enabled: boolean;
  /** X Premium: posts over 280 characters. */
  longPostsX: boolean;
  /** How late a delivery may still go out, in minutes. After that: MISSED. */
  graceMinutes: number;
  /** Who gets team alerts (client feedback, problems). Empty = first admin. */
  alertEmail: string | null;
  /** Every post needs at least one picture before it can go to review, be approved or scheduled. */
  requireImage: boolean;
};
export const DEFAULT_SETTINGS: PublishSettings = { enabled: true, longPostsX: false, graceMinutes: 120, alertEmail: null, requireImage: true };

// ── Pictures ─────────────────────────────────────────────────────────────────

/** One picture per post, the same on LinkedIn and X (Olivier, 2026-10-11). */
export const MAX_IMAGES = 1;
/** X's limit per picture; pictures are resized in the browser well below it. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif"];

export function mediaUrl(m: { id: string; key: string }): string {
  return `${SITE}/api/media/${m.id}?k=${m.key}`;
}
export type MediaMeta = { id: string; key: string; position: number; mime: string; name: string | null; width: number | null; height: number | null; sizeBytes: number };
/** Everything about a picture except its bytes — for lists. */
export const MEDIA_SELECT = { id: true, key: true, position: true, mime: true, name: true, width: true, height: true, sizeBytes: true } as const;

export type NetSession = { signedIn: boolean; as: string | null; signedOutSince: string | null; emailedFor: string | null };
export type PublisherState = {
  lastSeenAt: string | null;
  version: string | null;
  x: NetSession;
  linkedin: NetSession;
  lastPostAt: string | null;
  lastError: string | null;
};
const NO_SESSION: NetSession = { signedIn: false, as: null, signedOutSince: null, emailedFor: null };
const EMPTY_STATE: PublisherState = { lastSeenAt: null, version: null, x: NO_SESSION, linkedin: NO_SESSION, lastPostAt: null, lastError: null };

export const LIVE_WINDOW_MS = 15 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 20 * 60 * 1000;
export const MAX_ATTEMPTS = 3;

async function readJson<T extends object>(orgId: string, key: string, fallback: T): Promise<T> {
  const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } });
  if (!row?.value) return structuredClone(fallback);
  try {
    return { ...structuredClone(fallback), ...(JSON.parse(row.value) as Partial<T>) };
  } catch {
    return structuredClone(fallback);
  }
}
async function writeSetting(orgId: string, key: string, value: string): Promise<void> {
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value },
    update: { value },
  });
}

export async function getSettings(orgId: string): Promise<PublishSettings> {
  return readJson(orgId, SETTINGS_KEY, DEFAULT_SETTINGS);
}
export async function saveSettings(orgId: string, patch: Partial<PublishSettings>): Promise<PublishSettings> {
  const next = { ...(await getSettings(orgId)), ...patch };
  next.graceMinutes = Math.min(1440, Math.max(15, Math.round(Number(next.graceMinutes) || 120)));
  next.alertEmail = next.alertEmail && /.+@.+\..+/.test(next.alertEmail) ? next.alertEmail.trim() : null;
  next.requireImage = next.requireImage !== false;
  await writeSetting(orgId, SETTINGS_KEY, JSON.stringify(next));
  return next;
}
export async function getPublisherState(orgId: string): Promise<PublisherState> {
  const s = await readJson(orgId, PUBLISHER_KEY, EMPTY_STATE);
  s.x = { ...NO_SESSION, ...(s.x || {}) };
  s.linkedin = { ...NO_SESSION, ...(s.linkedin || {}) };
  return s;
}
export async function savePublisherState(orgId: string, s: PublisherState): Promise<void> {
  await writeSetting(orgId, PUBLISHER_KEY, JSON.stringify(s));
}

export type Live = { level: "live" | "signed_out" | "offline" | "never"; label: string };
export function liveStatus(st: PublisherState): { overall: Live; x: Live; linkedin: Live } {
  const fresh = !!st.lastSeenAt && Date.now() - new Date(st.lastSeenAt).getTime() < LIVE_WINDOW_MS;
  const one = (s: NetSession, name: string): Live => {
    if (!st.lastSeenAt) return { level: "never", label: `${name}: the publishing browser has not checked in yet` };
    if (!fresh) return { level: "offline", label: `${name}: publishing browser offline` };
    if (!s.signedIn) return { level: "signed_out", label: `${name}: signed out` };
    return { level: "live", label: `${name}: live${s.as ? " as " + (name === "X" ? "@" : "") + s.as : ""}` };
  };
  const x = one(st.x, "X");
  const linkedin = one(st.linkedin, "LinkedIn");
  const worst = [linkedin, x].find((l) => l.level !== "live");
  return {
    overall: worst ? { level: worst.level, label: [linkedin.label, x.label].join(" · ") } : { level: "live", label: [linkedin.label, x.label].join(" · ") },
    x,
    linkedin,
  };
}

// ── Text rules ───────────────────────────────────────────────────────────────

/** X's count: every URL is 23, everything else one per code point. */
export function xLength(text: string): number {
  const urlRe = /https?:\/\/\S+/gi;
  const urls = text.match(urlRe) || [];
  return Array.from(text.replace(urlRe, "")).length + urls.length * 23;
}
export const LINKEDIN_MAX = 3000;
export function xMax(s: PublishSettings): number {
  return s.longPostsX ? 25000 : 280;
}

export function parsePlatforms(v: unknown): Net[] {
  const list = Array.isArray(v) ? v : String(v || "").split(",");
  const out = list.map((x) => String(x).trim().toUpperCase()).filter((x): x is Net => (PLATFORMS as readonly string[]).includes(x));
  return Array.from(new Set(out));
}

export function textFor(item: { text: string; textX: string | null }, net: Net): string {
  return net === "TWITTER" && item.textX?.trim() ? item.textX.trim() : item.text;
}

/**
 * Problems that block review/approval/scheduling: too long for a network, or
 * no picture when the workspace requires one (pass mediaCount to check it).
 */
export function textProblems(item: { text: string; textX: string | null; platforms: string }, s: PublishSettings, mediaCount?: number): string[] {
  const nets = parsePlatforms(item.platforms);
  const out: string[] = [];
  if (!nets.length) out.push("Pick at least one network.");
  if (mediaCount !== undefined && s.requireImage && mediaCount === 0) out.push("Add a picture — every post needs one.");
  if (mediaCount !== undefined && mediaCount > MAX_IMAGES) out.push("Only one picture per post.");
  if (nets.includes("LINKEDIN") && Array.from(item.text).length > LINKEDIN_MAX) out.push(`Too long for LinkedIn (${Array.from(item.text).length} / ${LINKEDIN_MAX}).`);
  if (nets.includes("TWITTER")) {
    const t = textFor(item, "TWITTER");
    if (xLength(t) > xMax(s)) out.push(`Too long for X (${xLength(t)} / ${xMax(s)}) — add a shorter X version.`);
  }
  return out;
}

// ── Per-client targets + review links ────────────────────────────────────────

export type Target = {
  /** X @handle, without "@". */
  xHandle: string | null;
  /** LinkedIn company page or profile URL to post as. */
  linkedinUrl: string | null;
  reviewerName: string | null;
  reviewerEmail: string | null;
};

export function normalizeHandle(h: string | null | undefined): string | null {
  if (!h) return null;
  const m = String(h).trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?#\s]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(m) ? m : null;
}
export function normalizeLinkedIn(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = String(u).trim();
  const m = s.match(/linkedin\.com\/(company|showcase|in)\/([^/?#]+)/i);
  return m ? `https://www.linkedin.com/${m[1].toLowerCase()}/${m[2]}/` : null;
}

const targetKey = (clientId: string) => `publish_target:${clientId}`;
const reviewKey = (clientId: string) => `review_token:${clientId}`;

export async function getTarget(orgId: string, clientId: string): Promise<Target> {
  const saved = await readJson<Target>(orgId, targetKey(clientId), { xHandle: null, linkedinUrl: null, reviewerName: null, reviewerEmail: null });
  if (!saved.xHandle || !saved.linkedinUrl) {
    // Default to the accounts already tracked for this company.
    const conns = await prisma.platformConnection.findMany({
      where: { organizationId: orgId, clientId, platform: { in: ["TWITTER", "LINKEDIN"] } },
      select: { platform: true, externalAccountUrl: true, externalAccountName: true },
    });
    for (const c of conns) {
      if (c.platform === "TWITTER" && !saved.xHandle) saved.xHandle = normalizeHandle(c.externalAccountUrl) || normalizeHandle(c.externalAccountName);
      if (c.platform === "LINKEDIN" && !saved.linkedinUrl) saved.linkedinUrl = normalizeLinkedIn(c.externalAccountUrl);
    }
  }
  return saved;
}
export async function saveTarget(orgId: string, clientId: string, t: Partial<Target>): Promise<Target> {
  const cur = await readJson<Target>(orgId, targetKey(clientId), { xHandle: null, linkedinUrl: null, reviewerName: null, reviewerEmail: null });
  const next: Target = {
    xHandle: t.xHandle !== undefined ? normalizeHandle(t.xHandle) : cur.xHandle,
    linkedinUrl: t.linkedinUrl !== undefined ? normalizeLinkedIn(t.linkedinUrl) : cur.linkedinUrl,
    reviewerName: t.reviewerName !== undefined ? (t.reviewerName || "").trim() || null : cur.reviewerName,
    reviewerEmail:
      t.reviewerEmail !== undefined ? (t.reviewerEmail && /.+@.+\..+/.test(t.reviewerEmail) ? t.reviewerEmail.trim() : null) : cur.reviewerEmail,
  };
  await writeSetting(orgId, targetKey(clientId), JSON.stringify(next));
  return getTarget(orgId, clientId);
}

function mintToken(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function reviewToken(orgId: string, clientId: string, rotate = false): Promise<string> {
  if (!rotate) {
    const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: reviewKey(clientId) } } });
    if (row?.value) return row.value;
  }
  const t = mintToken();
  await writeSetting(orgId, reviewKey(clientId), t);
  return t;
}
export function reviewUrl(token: string): string {
  return `${SITE}/review/${token}`;
}
export async function resolveReviewToken(token: string): Promise<{ orgId: string; clientId: string } | null> {
  if (!/^[a-f0-9]{36}$/.test(token)) return null;
  const row = await prisma.orgSetting.findFirst({ where: { key: { startsWith: "review_token:" }, value: token } });
  if (!row?.organizationId) return null;
  return { orgId: row.organizationId, clientId: row.key.slice("review_token:".length) };
}

// ── Thread ───────────────────────────────────────────────────────────────────

export async function addEvent(
  orgId: string,
  contentId: string,
  version: number,
  kind: string,
  authorRole: "team" | "client",
  authorName: string | null,
  body: string | null = null,
): Promise<void> {
  await prisma.contentComment.create({
    data: { organizationId: orgId, contentId, version, kind, authorRole, authorName, body: body?.slice(0, 5000) ?? null },
  });
}

// ── Email ────────────────────────────────────────────────────────────────────

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
export function nyTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " (New York)";
}

async function teamRecipient(orgId: string): Promise<string | null> {
  const s = await getSettings(orgId);
  if (s.alertEmail) return s.alertEmail;
  const u = await prisma.user.findFirst({
    where: { organizationId: orgId, isActive: true, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return u?.email ?? null;
}

export async function sendMail(to: string | null, subject: string, html: string, cta?: { href: string; label: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) return false;
  const button = cta
    ? `<p><a href="${cta.href}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(cta.label)}</a></p>`
    : "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: resolveFrom(),
        to: [to],
        subject,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${html}${button}</div>`,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function alertTeam(orgId: string, subject: string, html: string, href = `${SITE}/publishing`): Promise<boolean> {
  return sendMail(await teamRecipient(orgId), subject, html, { href, label: "Open Publishing" });
}

export function quote(text: string): string {
  return `<blockquote style="border-left:3px solid #ddd;margin:8px 0;padding:4px 12px;color:#333;white-space:pre-wrap">${esc(text.slice(0, 1200))}</blockquote>`;
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/** Create one delivery per network for an approved item. Returns problems, if any. */
export async function scheduleItem(orgId: string, itemId: string, when: Date): Promise<string[]> {
  const item = await prisma.contentItem.findFirst({ where: { id: itemId, organizationId: orgId } });
  if (!item) return ["Content not found."];
  if (!item.approvedAt || !["APPROVED", "SCHEDULED", "FAILED", "PARTIAL"].includes(item.status)) {
    return ["Only approved content can be scheduled."];
  }
  const settings = await getSettings(orgId);
  const media = await prisma.contentMedia.findMany({ where: { contentId: item.id }, select: MEDIA_SELECT, orderBy: { position: "asc" } });
  const problems = textProblems(item, settings, media.length);
  if (problems.length) return problems;
  const mediaJson = media.length
    ? JSON.stringify(media.map((m) => ({ url: mediaUrl(m), mime: m.mime, name: m.name || `picture-${m.position + 1}.jpg` })))
    : null;
  const nets = parsePlatforms(item.platforms);
  const target = item.clientId ? await getTarget(orgId, item.clientId) : { xHandle: null, linkedinUrl: null };
  if (nets.includes("TWITTER") && !target.xHandle) problems.push("No X account set for this client (Publishing → Accounts).");
  if (nets.includes("LINKEDIN") && !target.linkedinUrl) problems.push("No LinkedIn page set for this client (Publishing → Accounts).");
  if (problems.length) return problems;

  // Replace whatever has not gone out yet; keep what already went out.
  const existing = await prisma.scheduledPost.findMany({ where: { contentId: item.id } });
  const done = new Set(existing.filter((d) => d.status === "POSTED" || d.status === "POSTING").map((d) => d.platform));
  await prisma.scheduledPost.deleteMany({ where: { contentId: item.id, status: { in: ["SCHEDULED", "FAILED", "MISSED"] } } });
  for (const net of nets) {
    if (done.has(net)) continue;
    await prisma.scheduledPost.create({
      data: {
        organizationId: orgId,
        contentId: item.id,
        clientId: item.clientId,
        platform: net,
        target: net === "TWITTER" ? target.xHandle : target.linkedinUrl,
        text: textFor(item, net),
        mediaJson,
        status: "SCHEDULED",
        scheduledAt: when,
      },
    });
  }
  await prisma.contentItem.update({ where: { id: item.id }, data: { status: "SCHEDULED", scheduledAt: when } });
  return [];
}

/**
 * The wording or the pictures changed: it is a new version, and anything
 * approved or with the client goes back to DRAFT (approval covers exactly what
 * was approved). Whatever has not gone out yet is unscheduled.
 */
export async function markChanged(orgId: string, itemId: string, by: string, note: string): Promise<void> {
  const item = await prisma.contentItem.findFirst({ where: { id: itemId, organizationId: orgId } });
  if (!item) return;
  if (item.status === "SCHEDULED" || item.status === "FAILED") await unscheduleItem(orgId, item.id);
  const back = ["IN_REVIEW", "APPROVED", "SCHEDULED", "FAILED"].includes(item.status);
  await prisma.contentItem.update({
    where: { id: item.id },
    data: {
      version: item.version + 1,
      ...(back ? { status: "DRAFT", approvedAt: null, approvedBy: null, approvedRole: null, scheduledAt: null } : {}),
    },
  });
  await addEvent(orgId, item.id, item.version + 1, "edited", "team", by, note);
}

export async function mediaCount(itemId: string): Promise<number> {
  return prisma.contentMedia.count({ where: { contentId: itemId } });
}

export async function unscheduleItem(orgId: string, itemId: string): Promise<void> {
  await prisma.scheduledPost.deleteMany({ where: { organizationId: orgId, contentId: itemId, status: { in: ["SCHEDULED", "FAILED", "MISSED"] } } });
  const left = await prisma.scheduledPost.count({ where: { contentId: itemId } });
  await prisma.contentItem.update({ where: { id: itemId }, data: { status: left ? "PARTIAL" : "APPROVED", scheduledAt: left ? undefined : null } });
}

/** Roll an item's status up from its deliveries. */
export async function rollUp(itemId: string): Promise<void> {
  const item = await prisma.contentItem.findUnique({ where: { id: itemId }, include: { deliveries: true } });
  if (!item || !item.deliveries.length) return;
  if (!["SCHEDULED", "PUBLISHED", "PARTIAL", "FAILED"].includes(item.status)) return;
  const st = item.deliveries.map((d) => d.status);
  let next = "SCHEDULED";
  if (st.every((s) => s === "POSTED")) next = "PUBLISHED";
  else if (st.some((s) => s === "SCHEDULED" || s === "POSTING")) next = "SCHEDULED";
  else if (st.some((s) => s === "POSTED")) next = "PARTIAL";
  else next = "FAILED";
  if (next !== item.status) {
    await prisma.contentItem.update({ where: { id: itemId }, data: { status: next } });
    if (next === "PUBLISHED" && item.organizationId) {
      await addEvent(item.organizationId, itemId, item.version, "published", "team", "Social", null);
    }
  }
}

// ── Sweep ────────────────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return (s || "").replace(/https?:\/\/\S+/gi, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

export async function sweep(orgId: string): Promise<{ missed: number; failed: number; verified: number }> {
  const settings = await getSettings(orgId);
  const now = Date.now();
  const touched = new Set<string>();
  let missed = 0, failed = 0, verified = 0;

  const late = await prisma.scheduledPost.findMany({
    where: { organizationId: orgId, status: "SCHEDULED", scheduledAt: { lt: new Date(now - settings.graceMinutes * 60000) } },
  });
  for (const d of late) {
    await prisma.scheduledPost.update({
      where: { id: d.id },
      data: { status: "MISSED", alertedAt: new Date(), lastError: d.lastError || "Not published in time — the publishing browser was not available." },
    });
    missed++;
    if (d.contentId) touched.add(d.contentId);
    await alertTeam(
      orgId,
      `A ${NET_LABEL[d.platform as Net] ?? d.platform} post did not go out`,
      `<p>Scheduled for <b>${nyTime(d.scheduledAt)}</b> on <b>${NET_LABEL[d.platform as Net] ?? d.platform}</b> — <b>not published</b>.</p>${quote(d.text)}
       <p>Reason: ${esc(d.lastError || "the publishing browser (Chrome with the Social extension) was offline or signed out.")}</p>`,
      `${SITE}/publishing/calendar`,
    );
  }

  const stuck = await prisma.scheduledPost.findMany({
    where: { organizationId: orgId, status: "POSTING", claimedAt: { lt: new Date(now - CLAIM_TIMEOUT_MS) } },
  });
  for (const d of stuck) {
    await prisma.scheduledPost.update({
      where: { id: d.id },
      data: { status: "FAILED", alertedAt: new Date(), lastError: "The publishing browser started this post and never reported back. Check the network before retrying." },
    });
    failed++;
    if (d.contentId) touched.add(d.contentId);
    await alertTeam(
      orgId,
      `A ${NET_LABEL[d.platform as Net] ?? d.platform} post may not have gone out`,
      `<p>Publishing started ${nyTime(d.claimedAt)} and never reported back.</p>${quote(d.text)}<p>Check the network: if it is not there, press Retry.</p>`,
      `${SITE}/publishing/calendar`,
    );
  }

  const unconfirmed = await prisma.scheduledPost.findMany({
    where: { organizationId: orgId, status: "POSTED", verifiedAt: null, postedAt: { gt: new Date(now - 14 * 86400000) } },
    take: 50,
  });
  if (unconfirmed.length) {
    const since = new Date(Math.min(...unconfirmed.map((p) => (p.postedAt ?? new Date()).getTime())) - 86400000);
    const collected = await prisma.socialPost.findMany({
      where: { organizationId: orgId, platform: { in: ["TWITTER", "LINKEDIN"] }, publishedAtUtc: { gte: since } },
      select: { platform: true, externalPostId: true, postUrl: true, postTextFull: true, postTextSnippet: true },
      take: 1000,
    });
    for (const d of unconfirmed) {
      const want = norm(d.text).slice(0, 40);
      const hit = collected.find(
        (c) =>
          c.platform === d.platform &&
          ((d.externalPostId && c.externalPostId === d.externalPostId) ||
            (want.length >= 10 && norm(c.postTextFull || c.postTextSnippet).startsWith(want))),
      );
      if (hit) {
        await prisma.scheduledPost.update({
          where: { id: d.id },
          data: { verifiedAt: new Date(), verifiedVia: "collection", postUrl: d.postUrl || hit.postUrl, externalPostId: d.externalPostId || hit.externalPostId },
        });
        verified++;
      }
    }
  }

  for (const id of touched) await rollUp(id);

  // One email per sign-out lasting more than 10 minutes, per network.
  const st = await getPublisherState(orgId);
  let changed = false;
  for (const [key, label] of [["x", "X"], ["linkedin", "LinkedIn"]] as const) {
    const s = st[key];
    if (!s.signedIn && s.signedOutSince && s.emailedFor !== s.signedOutSince && now - new Date(s.signedOutSince).getTime() > 10 * 60000) {
      const pending = await prisma.scheduledPost.count({
        where: { organizationId: orgId, status: "SCHEDULED", platform: key === "x" ? "TWITTER" : "LINKEDIN" },
      });
      if (pending === 0) continue; // nothing waiting; the LinkedIn watchdog already covers collection
      if (
        await alertTeam(
          orgId,
          `${label} signed you out — ${pending} scheduled post${pending === 1 ? " is" : "s are"} on hold`,
          `<p>${label} signed the publishing browser out at <b>${nyTime(new Date(s.signedOutSince))}</b>.</p>
           <p>On the publishing computer the ${label} login page is already open — 1Password fills it in one click.</p>`,
          `${SITE}/publishing/calendar`,
        )
      ) {
        s.emailedFor = s.signedOutSince;
        changed = true;
      }
    }
  }
  if (changed) await savePublisherState(orgId, st);

  return { missed, failed, verified };
}

export async function orgsWithDeliveries(): Promise<string[]> {
  const rows = await prisma.scheduledPost.findMany({
    where: { status: { in: ["SCHEDULED", "POSTING", "POSTED"] } },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });
  return rows.map((r) => r.organizationId).filter((x): x is string => !!x);
}
