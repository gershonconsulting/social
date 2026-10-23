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
import { siteUrl } from "@/lib/site";
import { withAuditBcc } from "@/lib/mail-bcc";

export const SITE = siteUrl();

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
  /** Who is told content is validated and ready for publishing (Olivier, 2026-10-18). */
  readyEmail: string;
};
export const READY_EMAIL_DEFAULT = "social@gershonconsulting.com";
export const DEFAULT_SETTINGS: PublishSettings = { enabled: true, longPostsX: false, graceMinutes: 120, alertEmail: null, requireImage: true, readyEmail: READY_EMAIL_DEFAULT };

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
  next.readyEmail = next.readyEmail && /.+@.+\..+/.test(next.readyEmail) ? next.readyEmail.trim() : READY_EMAIL_DEFAULT;
  await writeSetting(orgId, SETTINGS_KEY, JSON.stringify(next));
  return next;
}
/** clientId given → the state of THAT company's own publishing browser (v4.42.0). */
export async function getPublisherState(orgId: string, clientId?: string | null): Promise<PublisherState> {
  const s = await readJson(orgId, clientId ? `${PUBLISHER_KEY}:${clientId}` : PUBLISHER_KEY, EMPTY_STATE);
  s.x = { ...NO_SESSION, ...(s.x || {}) };
  s.linkedin = { ...NO_SESSION, ...(s.linkedin || {}) };
  return s;
}
export async function savePublisherState(orgId: string, s: PublisherState, clientId?: string | null): Promise<void> {
  await writeSetting(orgId, clientId ? `${PUBLISHER_KEY}:${clientId}` : PUBLISHER_KEY, JSON.stringify(s));
}

// ── Who publishes a company's posts (v4.42.0) ────────────────────────────────
//
// Gershon is the master workspace: content for every company is written,
// reviewed and approved here. Publishing is then done EITHER by Gershon's own
// publishing browser ("workspace", the default) OR by the client's own Chrome
// extension, signed in to the client's own LinkedIn page and X account
// ("client"). A client extension connects with a key that belongs to that one
// company: it can fetch only that company's approved, due posts and report
// their results — nothing else in the workspace.

export type PublishRoute = "workspace" | "client";
const routeKey = (clientId: string) => `publish_route:${clientId}`;
const publishKeyKey = (clientId: string) => `publish_key:${clientId}`;

export async function getRoute(orgId: string, clientId: string): Promise<PublishRoute> {
  const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: routeKey(clientId) } } });
  return row?.value === "client" ? "client" : "workspace";
}
export async function setRoute(orgId: string, clientId: string, route: PublishRoute): Promise<void> {
  await writeSetting(orgId, routeKey(clientId), route);
}
/** Companies whose posts only their own browser may publish. */
export async function clientRoutedIds(orgId: string): Promise<string[]> {
  const rows = await prisma.orgSetting.findMany({
    where: { organizationId: orgId, key: { startsWith: "publish_route:" }, value: "client" },
    select: { key: true },
  });
  return rows.map((r) => r.key.slice("publish_route:".length));
}
export async function publishKey(orgId: string, clientId: string, rotate = false): Promise<string> {
  if (!rotate) {
    const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: publishKeyKey(clientId) } } });
    if (row?.value) return row.value;
  }
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  const k = "gp_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  await writeSetting(orgId, publishKeyKey(clientId), k);
  return k;
}
export function connectUrl(key: string): string {
  return `${SITE}/connect/${key}`;
}
export async function resolvePublishKey(key: string): Promise<{ orgId: string; clientId: string } | null> {
  if (!/^gp_[a-f0-9]{48}$/.test(key)) return null;
  const row = await prisma.orgSetting.findFirst({ where: { key: { startsWith: "publish_key:" }, value: key } });
  if (!row?.organizationId) return null;
  const clientId = row.key.slice("publish_key:".length);
  // A key only works while the company is set to publish through its own browser.
  if ((await getRoute(row.organizationId, clientId)) !== "client") return null;
  return { orgId: row.organizationId, clientId };
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

/**
 * Where a company's posts go (v4.53.0). Five kinds — Olivier, 2026-10-18:
 * LinkedIn company page, LinkedIn personal profile, LinkedIn group,
 * X company account, X personal account. A company can post to several at
 * once: each approved post gets one delivery per enabled destination of the
 * post's networks. The main LinkedIn URL / X handle are the first two; more
 * live in `destinations`.
 */
export type DestKind = "page" | "profile" | "group" | "company" | "personal";
export type Destination = { id: string; network: Net; kind: DestKind; target: string; enabled: boolean };
export const DEST_LABEL: Record<DestKind, string> = {
  page: "LinkedIn company page", profile: "LinkedIn personal profile", group: "LinkedIn group", company: "X company account", personal: "X personal account",
};
export function linkedInKind(url: string): DestKind {
  return /\/groups\//.test(url) ? "group" : /\/in\//.test(url) ? "profile" : "page";
}
function cleanDestinations(v: unknown): Destination[] {
  if (!Array.isArray(v)) return [];
  const out: Destination[] = [];
  for (const raw of v.slice(0, 12)) {
    const d = (raw || {}) as Partial<Destination>;
    const network = d.network === "TWITTER" ? "TWITTER" : d.network === "LINKEDIN" ? "LINKEDIN" : null;
    if (!network) continue;
    const target = network === "TWITTER" ? normalizeHandle(d.target) : normalizeLinkedIn(d.target);
    if (!target) continue;
    const kind: DestKind = network === "LINKEDIN" ? linkedInKind(target) : d.kind === "personal" ? "personal" : "company";
    out.push({ id: d.id || Math.random().toString(36).slice(2, 10), network, kind, target, enabled: d.enabled !== false });
  }
  return out;
}
/** Every enabled place this company posts to: the main LinkedIn + X, then the extra ones. */
export function destinationsOf(t: Target): Destination[] {
  const all: Destination[] = [];
  if (t.linkedinUrl) all.push({ id: "main-li", network: "LINKEDIN", kind: linkedInKind(t.linkedinUrl), target: t.linkedinUrl, enabled: true });
  if (t.xHandle) all.push({ id: "main-x", network: "TWITTER", kind: t.xKind === "personal" ? "personal" : "company", target: t.xHandle, enabled: true });
  for (const d of t.destinations || []) {
    if (!d.enabled) continue;
    if (all.some((a) => a.network === d.network && a.target.toLowerCase() === d.target.toLowerCase())) continue;
    all.push(d);
  }
  return all;
}

export type Target = {
  /** X @handle, without "@". */
  xHandle: string | null;
  /** LinkedIn company page, profile or group URL to post to. */
  linkedinUrl: string | null;
  reviewerName: string | null;
  reviewerEmail: string | null;
  /** The main X account: a company or a personal account. */
  xKind?: "company" | "personal";
  /** More places to post (v4.53.0). */
  destinations?: Destination[];
};

export function normalizeHandle(h: string | null | undefined): string | null {
  if (!h) return null;
  const m = String(h).trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?#\s]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(m) ? m : null;
}
export function normalizeLinkedIn(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = String(u).trim();
  // A LinkedIn group (v4.52.0, e.g. AmericanAbroad.net's group): posted from the group page.
  const g = s.match(/linkedin\.com\/groups\/(\d+)/i);
  if (g) return `https://www.linkedin.com/groups/${g[1]}/`;
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
// v4.59.0 audit: an invalid reviewer email used to be silently saved as null
// (so review emails quietly stopped). Now it is rejected; the accounts PUT
// route turns this error into a 400 "Invalid reviewer email".
export class InvalidReviewerEmailError extends Error {
  constructor() { super("Invalid reviewer email"); this.name = "InvalidReviewerEmailError"; }
}
export async function saveTarget(orgId: string, clientId: string, t: Partial<Target>): Promise<Target> {
  const cur = await readJson<Target>(orgId, targetKey(clientId), { xHandle: null, linkedinUrl: null, reviewerName: null, reviewerEmail: null });
  // v4.59.0 audit: empty clears the reviewer; anything else must look like an email.
  if (t.reviewerEmail !== undefined && (t.reviewerEmail || "").trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((t.reviewerEmail || "").trim())) {
    throw new InvalidReviewerEmailError();
  }
  const next: Target = {
    xHandle: t.xHandle !== undefined ? normalizeHandle(t.xHandle) : cur.xHandle,
    linkedinUrl: t.linkedinUrl !== undefined ? normalizeLinkedIn(t.linkedinUrl) : cur.linkedinUrl,
    reviewerName: t.reviewerName !== undefined ? (t.reviewerName || "").trim() || null : cur.reviewerName,
    reviewerEmail:
      t.reviewerEmail !== undefined ? (t.reviewerEmail || "").trim() || null : cur.reviewerEmail,
    xKind: t.xKind !== undefined ? (t.xKind === "personal" ? "personal" : "company") : cur.xKind,
    destinations: t.destinations !== undefined ? cleanDestinations(t.destinations) : cleanDestinations(cur.destinations),
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

export async function teamRecipient(orgId: string): Promise<string | null> {
  const s = await getSettings(orgId);
  if (s.alertEmail) return s.alertEmail;
  // v4.61.1: no alert address set → the publishing inbox (social@ by default).
  // It used to fall back to the first ADMIN user, admin@gershonconsulting.com,
  // which bounced on 2026-10-12 and is suppressed in Resend — so every "asked
  // for changes", "post failed to publish" and inventory alert was dropped.
  return s.readyEmail || READY_EMAIL_DEFAULT;
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
      body: JSON.stringify(withAuditBcc({
        from: resolveFrom(),
        to: [to],
        subject,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">${html}${button}</div>`,
      })),
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
  let nets = parsePlatforms(item.platforms);
  const dests = item.clientId ? destinationsOf(await getTarget(orgId, item.clientId)).filter((d) => nets.includes(d.network)) : [];
  // v4.55.1: a network with no account for this company is skipped (e.g. PuenteLatin
  // has an X account but no LinkedIn page) — the post still goes out on the others.
  const missing = nets.filter((n) => !dests.some((d) => d.network === n));
  if (missing.length && missing.length < nets.length) {
    nets = nets.filter((n) => !missing.includes(n));
    await prisma.contentItem.update({ where: { id: item.id }, data: { platforms: nets.join(",") } });
    await addEvent(orgId, item.id, item.version, "comment", "team", "Publishing",
      `Not posted on ${missing.map((n) => (n === "TWITTER" ? "X" : "LinkedIn")).join(" and ")}: no account set for this company in Publishing → Accounts. Posting on ${nets.map((n) => (n === "TWITTER" ? "X" : "LinkedIn")).join(" and ")} only.`);
  } else {
    if (nets.includes("TWITTER") && !dests.some((d) => d.network === "TWITTER")) problems.push("No X account set for this client (Publishing → Accounts).");
    if (nets.includes("LINKEDIN") && !dests.some((d) => d.network === "LINKEDIN")) problems.push("No LinkedIn page, profile or group set for this client (Publishing → Accounts).");
  }
  if (problems.length) return problems;

  // Replace whatever has not gone out yet; keep what already went out.
  // One delivery per destination (v4.53.0): e.g. the company page AND the group.
  const existing = await prisma.scheduledPost.findMany({ where: { contentId: item.id } });
  const key = (p: string, t: string | null) => `${p}|${(t || "").toLowerCase()}`;
  const done = new Set(existing.filter((d) => d.status === "POSTED" || d.status === "POSTING").map((d) => key(d.platform, d.target)));
  await prisma.scheduledPost.deleteMany({ where: { contentId: item.id, status: { in: ["SCHEDULED", "FAILED", "MISSED"] } } });
  for (const dest of dests) {
    const net = dest.network;
    if (done.has(key(net, dest.target))) continue;
    await prisma.scheduledPost.create({
      data: {
        organizationId: orgId,
        contentId: item.id,
        clientId: item.clientId,
        platform: net,
        target: dest.target,
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
  // v4.60.0: due posts of companies with a connected account go out through the API first.
  try {
    const { apiPublishDue } = await import("@/lib/linked-publish");
    await apiPublishDue(orgId);
  } catch { /* the extension and the checks below still run */ }
  const settings = await getSettings(orgId);
  const now = Date.now();
  const touched = new Set<string>();
  let missed = 0, failed = 0, verified = 0;
  const routedEarly = new Set(await clientRoutedIds(orgId));

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
       <p>Reason: ${esc(d.lastError || (d.clientId && routedEarly.has(d.clientId) ? "the client's own publishing browser (Chrome with the Social extension) was offline or signed out." : "the publishing browser (Chrome with the Social extension) was offline or signed out."))}</p>`,
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

  // One email per sign-out lasting more than 10 minutes, per network — for
  // the workspace browser and for each company's own browser (v4.42.0).
  const routed = await clientRoutedIds(orgId);
  for (const pubClient of [null, ...routed] as (string | null)[]) {
  const st = await getPublisherState(orgId, pubClient);
  const whose = pubClient
    ? `${(await prisma.client.findFirst({ where: { id: pubClient }, select: { name: true } }))?.name || "The client"}'s own publishing browser`
    : "the publishing browser";
  let changed = false;
  for (const [key, label] of [["x", "X"], ["linkedin", "LinkedIn"]] as const) {
    const s = st[key];
    if (!s.signedIn && s.signedOutSince && s.emailedFor !== s.signedOutSince && now - new Date(s.signedOutSince).getTime() > 10 * 60000) {
      const pending = await prisma.scheduledPost.count({
        where: {
          organizationId: orgId,
          status: "SCHEDULED",
          platform: key === "x" ? "TWITTER" : "LINKEDIN",
          ...(pubClient ? { clientId: pubClient } : routed.length ? { OR: [{ clientId: null }, { clientId: { notIn: routed } }] } : {}),
        },
      });
      if (pending === 0) continue; // nothing waiting; the LinkedIn watchdog already covers collection
      if (
        await alertTeam(
          orgId,
          `${label} signed you out — ${pending} scheduled post${pending === 1 ? " is" : "s are"} on hold`,
          `<p>${label} signed ${whose} out at <b>${nyTime(new Date(s.signedOutSince))}</b>.</p>
           <p>On the publishing computer the ${label} login page is already open — 1Password fills it in one click.</p>`,
          `${SITE}/publishing/calendar`,
        )
      ) {
        s.emailedFor = s.signedOutSince;
        changed = true;
      }
    }
  }
  if (changed) await savePublisherState(orgId, st, pubClient);
  }

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

// ── Validation done → "ready for publishing" (v4.54.0) ───────────────────────
//
// Olivier, 2026-10-18: content ready to validate → email to whoever validates
// it (the company's reviewer); validation done → email to
// social@gershonconsulting.com saying it is ready for publishing. One email
// per approval action (an "Approve all" or an auto-approval batch = one email).

export async function notifyReadyForPublishing(orgId: string, itemIds: string[], by: string, how: string): Promise<boolean> {
  if (!itemIds.length) return false;
  const items = await prisma.contentItem.findMany({
    where: { organizationId: orgId, id: { in: itemIds } },
    select: { id: true, clientId: true, title: true, text: true, scheduledAt: true, platforms: true },
    orderBy: { scheduledAt: "asc" },
  });
  if (!items.length) return false;
  const clientIds = Array.from(new Set(items.map((i) => i.clientId).filter((x): x is string => !!x)));
  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => clients.find((c) => c.id === id)?.name || "—";
  const companies = Array.from(new Set(items.map((i) => nameOf(i.clientId))));
  const rows = items
    .slice(0, 40)
    .map((i) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap">${esc(i.scheduledAt ? nyTime(i.scheduledAt).replace(" (New York)", "") : "no date yet")}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(nameOf(i.clientId))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee">${esc((i.title || i.text).split("\n")[0].slice(0, 110))}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;color:#666">${esc(parsePlatforms(i.platforms).map((n) => NET_LABEL[n]).join(" + "))}</td></tr>`)
    .join("");
  const s = await getSettings(orgId);
  return sendMail(
    s.readyEmail || READY_EMAIL_DEFAULT,
    `Ready for publishing: ${items.length} post${items.length === 1 ? "" : "s"} validated — ${companies.join(", ")}`,
    `<p><b>${items.length} post${items.length === 1 ? " is" : "s are"} validated and ready for publishing</b> (${esc(how)} by ${esc(by)}).</p>
     <table style="border-collapse:collapse;font-size:13px">${rows}</table>
     ${items.length > 40 ? `<p>…and ${items.length - 40} more.</p>` : ""}
     <p style="color:#555;font-size:13px">They go out on their planned day through the publishing browser; Publishing → Calendar shows each one.</p>`,
    { href: `${SITE}/publishing/calendar`, label: "Open the publishing calendar" },
  );
}

/** Who validates a company's content: its reviewer, or the team when none is set. */
export async function validatorOf(orgId: string, clientId: string): Promise<{ email: string | null; name: string | null; isTeam: boolean }> {
  const t = await getTarget(orgId, clientId);
  if (t.reviewerEmail) return { email: t.reviewerEmail, name: t.reviewerName, isTeam: false };
  return { email: await teamRecipient(orgId), name: null, isTeam: true };
}
