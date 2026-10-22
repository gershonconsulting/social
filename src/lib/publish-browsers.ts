/**
 * Which Chrome publishes which account (v4.63.0, extension 0.25.0).
 *
 * THE BUG IT FIXES. Every Chrome with the extension bound to the workspace
 * asked /api/extension/publish/due for "the next post" and got it — whatever
 * company it was for. So a Gershon Consulting post could land in a Chrome
 * whose LinkedIn account is not an admin of the Gershon page, or whose X is
 * not signed in to @GershonCons, and fail ("Could not open the post box…",
 * "This browser is signed in to X as @oattia…"), 3 tries, then FAILED — while
 * another Chrome that could have posted it sat idle.
 *
 * NOW. Each Chrome (0.25.0+) introduces itself with a stable id and says what
 * it can publish:
 *   - X: every account signed in to X in that browser (the account switcher),
 *   - LinkedIn: for each page/group it was asked about, whether its LinkedIn
 *     account can post there (it opens the page and checks for the admin view).
 * A post is handed only to a Chrome that can publish it. When no Chrome can,
 * nobody gets it, and Publishing → Connections says exactly what is missing.
 *
 * Stored one row per browser (OrgSetting "publish_browser:<id>") so browsers
 * checking in at the same time never overwrite each other.
 */
import prisma from "@/lib/db-raw";

export const BROWSER_PREFIX = "publish_browser:";
/** A browser is "online" when it checked in within this window. */
export const BROWSER_LIVE_MS = 15 * 60 * 1000;
/** A LinkedIn page check is redone after this long. */
export const LI_CHECK_TTL_MS = 12 * 60 * 60 * 1000;
/** A failed LinkedIn page check is redone sooner (sign-in, admin rights may change). */
export const LI_FAIL_TTL_MS = 3 * 60 * 60 * 1000;

export type LiCheck = { ok: boolean; at: string; why?: string | null };
export type PublishBrowser = {
  id: string;
  label: string;
  version: string | null;
  lastSeenAt: string;
  x: { signedIn: boolean; as: string | null; accounts: string[] };
  linkedin: { signedIn: boolean; name: string | null };
  /** LinkedIn target key → can this browser post there. */
  li: Record<string, LiCheck>;
  lastPostAt?: string | null;
  lastError?: string | null;
};

/** "company/gershonconsulting", "groups/42835334", "in/oattia" — or null. */
export function liKey(url: string | null | undefined): string | null {
  const m = String(url || "").match(/linkedin\.com\/(company|showcase|in|groups)\/([^/?#]+)/i);
  return m ? `${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}` : null;
}
export function xKey(h: string | null | undefined): string | null {
  const m = String(h || "").trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?#\s]/)[0];
  return /^[A-Za-z0-9_]{1,15}$/.test(m) ? m.toLowerCase() : null;
}

export function isOnline(b: PublishBrowser, now = Date.now()): boolean {
  return now - Date.parse(b.lastSeenAt) < BROWSER_LIVE_MS;
}

/** Can this browser publish to this target? true / false / null (not checked yet). */
export function canPublish(b: PublishBrowser, platform: string, target: string | null): boolean | null {
  if (platform === "TWITTER") {
    const k = xKey(target);
    if (!k || !b.x.signedIn) return false;
    const all = new Set([...(b.x.accounts || []).map((a) => a.toLowerCase()), (b.x.as || "").toLowerCase()].filter(Boolean));
    if (all.has(k)) return true;
    // Accounts list known and the handle is not in it → no.
    return (b.x.accounts || []).length ? false : null;
  }
  if (platform === "LINKEDIN") {
    const k = liKey(target);
    if (!k || !b.linkedin.signedIn) return false;
    const c = b.li?.[k];
    return c ? c.ok : null;
  }
  return false;
}

/**
 * Should THIS caller get this delivery?
 *   capable → yes.
 *   another online browser is capable → no (it will post it).
 *   nobody known capable → only a browser that has not been checked for it
 *   (LinkedIn: it will open the page and find out; legacy browsers with no id
 *   keep the old behaviour so nothing stops while they update).
 */
export function shouldHandTo(
  callerId: string | null,
  all: PublishBrowser[],
  platform: string,
  target: string | null,
  now = Date.now(),
): boolean {
  const online = all.filter((b) => isOnline(b, now));
  const me = callerId ? all.find((b) => b.id === callerId) || null : null;
  const mine = me ? canPublish(me, platform, target) : null;
  if (mine === true) return true;
  const other = online.some((b) => b.id !== callerId && canPublish(b, platform, target) === true);
  if (other) return false;
  if (!me) return true; // legacy extension (< 0.25.0): no id, old behaviour
  return mine === null;
}

/** Plain-language status of one target, for Publishing → Connections. */
export type TargetStatus = {
  platform: "LINKEDIN" | "TWITTER";
  target: string;
  level: "ok" | "checking" | "missing" | "offline";
  browsers: string[];
  message: string;
};
export function targetStatus(all: PublishBrowser[], platform: "LINKEDIN" | "TWITTER", target: string, now = Date.now()): TargetStatus {
  const online = all.filter((b) => isOnline(b, now));
  const yes = online.filter((b) => canPublish(b, platform, target) === true);
  const yesOffline = all.filter((b) => !isOnline(b, now) && canPublish(b, platform, target) === true);
  const unknown = online.filter((b) => canPublish(b, platform, target) === null);
  const label = platform === "TWITTER" ? "@" + (xKey(target) || target) : target.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  if (yes.length) return { platform, target, level: "ok", browsers: yes.map((b) => b.label), message: `Ready — posts go out from ${yes.map((b) => b.label).join(" or ")}.` };
  if (unknown.length && platform === "LINKEDIN") return { platform, target, level: "checking", browsers: [], message: "Checking — a Chrome with the extension is opening the page to see if it can post there (a few minutes)." };
  if (yesOffline.length) return { platform, target, level: "offline", browsers: yesOffline.map((b) => b.label), message: `${yesOffline.map((b) => b.label).join(" or ")} can post here but is offline — open Chrome on that computer.` };
  if (!all.length) return { platform, target, level: "offline", browsers: [], message: "Waiting for the publishing Chromes to update to extension 0.25.0 — they update themselves and appear here within about 20 minutes." };
  if (!online.length) return { platform, target, level: "offline", browsers: [], message: "No publishing Chrome is online — open Chrome on the publishing computer." };
  if (platform === "TWITTER") {
    const signedOut = online.every((b) => !b.x.signedIn);
    return {
      platform, target, level: "missing", browsers: [],
      message: signedOut
        ? `No Chrome is signed in to X. Sign in to ${label} on x.com in the publishing Chrome.`
        : `No Chrome is signed in to ${label}. In the publishing Chrome: x.com → your photo → "Add an existing account" → sign in as ${label}.`,
    };
  }
  const why = online.map((b) => b.li?.[liKey(target) || ""]?.why).find(Boolean);
  return {
    platform, target, level: "missing", browsers: [],
    message: /groups\//.test(target)
      ? `No Chrome's LinkedIn account is a member of this group. Join it (or sign in with a member account) in the publishing Chrome.`
      : `No Chrome's LinkedIn account can post on this page${why ? ` (${why})` : ""}. Make that LinkedIn account an admin of the page, or sign in with an admin account in the publishing Chrome.`,
  };
}

// ── Storage ──────────────────────────────────────────────────────────────────

export async function listBrowsers(orgId: string): Promise<PublishBrowser[]> {
  const rows = await prisma.orgSetting.findMany({ where: { organizationId: orgId, key: { startsWith: BROWSER_PREFIX } } });
  const out: PublishBrowser[] = [];
  for (const r of rows) {
    try {
      const b = JSON.parse(r.value || "{}") as PublishBrowser;
      if (b?.id && b.lastSeenAt) out.push(normalize(b));
    } catch {}
  }
  // Forget browsers not seen for 30 days.
  const stale = out.filter((b) => Date.now() - Date.parse(b.lastSeenAt) > 30 * 86400000);
  if (stale.length) {
    await prisma.orgSetting.deleteMany({ where: { organizationId: orgId, key: { in: stale.map((b) => BROWSER_PREFIX + b.id) } } }).catch(() => null);
  }
  return out.filter((b) => !stale.includes(b)).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

function normalize(b: PublishBrowser): PublishBrowser {
  return {
    ...b,
    label: b.label || "Chrome",
    x: { signedIn: !!b.x?.signedIn, as: b.x?.as || null, accounts: Array.isArray(b.x?.accounts) ? b.x.accounts.filter((a) => typeof a === "string").slice(0, 30) : [] },
    linkedin: { signedIn: !!b.linkedin?.signedIn, name: b.linkedin?.name || null },
    li: b.li && typeof b.li === "object" ? b.li : {},
  };
}

export async function getBrowser(orgId: string, id: string): Promise<PublishBrowser | null> {
  const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: BROWSER_PREFIX + id } } });
  if (!row?.value) return null;
  try { return normalize(JSON.parse(row.value)); } catch { return null; }
}

export async function saveBrowser(orgId: string, b: PublishBrowser): Promise<void> {
  const key = BROWSER_PREFIX + b.id;
  const value = JSON.stringify(normalize(b));
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value },
    update: { value },
  });
}

export function validBrowserId(v: unknown): string | null {
  return typeof v === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(v) ? v : null;
}

/** Record what one publish attempt taught us about this browser. */
export async function learnFromResult(orgId: string, browserId: string | null, platform: string, target: string | null, outcome: string, error: string | null): Promise<void> {
  if (!browserId) return;
  const b = await getBrowser(orgId, browserId);
  if (!b) return;
  const now = new Date().toISOString();
  let changed = false;
  if (platform === "LINKEDIN") {
    const k = liKey(target);
    if (k) {
      if (outcome === "posted" || outcome === "clicked_unconfirmed") { b.li[k] = { ok: true, at: now }; changed = true; }
      else if (error && /admin of the page|member of the group/i.test(error)) { b.li[k] = { ok: false, at: now, why: "not an admin" }; changed = true; }
    }
  }
  if (platform === "TWITTER") {
    const k = xKey(target);
    if (k && (outcome === "posted" || outcome === "clicked_unconfirmed") && !b.x.accounts.map((a) => a.toLowerCase()).includes(k)) {
      b.x.accounts.push(k);
      changed = true;
    }
    const m = (error || "").match(/signed in to X as @(\w+), the post is for @(\w+)/);
    if (m && b.x.accounts.length === 0) { b.x.accounts = [m[1].toLowerCase()]; changed = true; }
  }
  if (outcome === "posted" || outcome === "clicked_unconfirmed") { b.lastPostAt = now; b.lastError = null; changed = true; }
  else if (error) { b.lastError = error.slice(0, 300); changed = true; }
  if (changed) await saveBrowser(orgId, b);
}
