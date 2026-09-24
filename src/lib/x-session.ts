/**
 * Per-workspace platform sessions (X / Twitter and LinkedIn cookies).
 *
 * WHY THIS EXISTS (v4.8.0). Collection on X only works with a logged-in
 * session: X closed every anonymous route (syndication, guest tokens, nitter),
 * and the paid API is off the table. So the platform reads X "as" somebody.
 * Until now that somebody was always Olivier — the captured cookies sat in the
 * GLOBAL Setting table under "cookies:TWITTER", and /api/cookies/save wrote
 * there with no credential at all. With more than one workspace that is two
 * bugs at once: any tenant's extension would overwrite Gershon's X session,
 * and every tenant's collection would run on whoever saved last.
 *
 * Now each workspace carries its OWN session in OrgSetting. A new user signs
 * in with LinkedIn, connects THEIR X account, and from then on:
 *   - their own @handle is collected with their own session, and
 *   - every other account in their workspace (clients, partners, competition)
 *     is read with that same session — "their access", nobody else's.
 *
 * WE NEVER STORE AN X PASSWORD. X logins involve 2FA and device checks and a
 * server-side password login from a datacenter IP is exactly what X blocks.
 * What we keep is the browser session (auth_token + ct0) — either captured
 * automatically by the Chrome extension from the user's own logged-in x.com
 * tab, or pasted once in Settings. Signing out of X everywhere revokes it.
 *
 * AT REST these are encrypted (AES-GCM, key derived from NEXTAUTH_SECRET).
 * Rows written before v4.8.0 are plain JSON and are still read.
 */
import prisma from "@/lib/db-raw";

export type SessionPlatform = "LINKEDIN" | "TWITTER";

export type CookieBundle = {
  cookies: Record<string, string>;
  capturedAt: string | null;
  /** "extension" | "manual" | "legacy" */
  source?: string | null;
};

const EMPTY: CookieBundle = { cookies: {}, capturedAt: null, source: null };

export function cookieKey(platform: SessionPlatform): string {
  return `cookies:${platform}`;
}
export const X_HANDLE_KEY = "x_handle";

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

const PREFIX = "enc:v1:";
let keyPromise: Promise<CryptoKey | null> | null = null;

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getKey(): Promise<CryptoKey | null> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) return null;
      const material = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("gershon-x-session:" + secret),
      );
      return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    })().catch(() => null);
  }
  return keyPromise;
}

export async function sealValue(plain: string): Promise<string> {
  const key = await getKey();
  if (!key) return plain; // no secret configured (local dev) — store as-is
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return PREFIX + b64(iv) + ":" + b64(new Uint8Array(ct));
}

export async function openValue(stored: string): Promise<string | null> {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plain JSON
  const key = await getKey();
  if (!key) return null;
  try {
    const [ivB64, ctB64] = stored.slice(PREFIX.length).split(":");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, unb64(ctB64));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

function parseBundle(raw: string | null): CookieBundle {
  if (!raw) return EMPTY;
  try {
    const p = JSON.parse(raw) as Partial<CookieBundle>;
    return {
      cookies: p.cookies && typeof p.cookies === "object" ? p.cookies : {},
      capturedAt: p.capturedAt ?? null,
      source: p.source ?? null,
    };
  } catch {
    return EMPTY;
  }
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

async function isPrimaryOrg(orgId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { isPrimary: true } });
  return !!org?.isPrimary;
}

/** This workspace's captured session for a platform. */
export async function getOrgCookies(orgId: string, platform: SessionPlatform): Promise<CookieBundle> {
  const row = await prisma.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: cookieKey(platform) } },
  });
  if (row?.value) return parseBundle(await openValue(row.value));

  // Pre-tenancy fallback: the original workspace may still only have the
  // global row. No other workspace ever reads it.
  if (await isPrimaryOrg(orgId)) {
    const legacy = await prisma.setting.findUnique({ where: { key: cookieKey(platform) } });
    if (legacy?.value) return { ...parseBundle(legacy.value), source: "legacy" };
  }
  return EMPTY;
}

export async function saveOrgCookies(
  orgId: string,
  platform: SessionPlatform,
  cookies: Record<string, string>,
  opts: { capturedAt?: string | null; source?: string } = {},
): Promise<CookieBundle> {
  const bundle: CookieBundle = {
    cookies,
    capturedAt: opts.capturedAt ?? new Date().toISOString(),
    source: opts.source ?? "extension",
  };
  const value = await sealValue(JSON.stringify(bundle));
  const key = cookieKey(platform);
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value },
    update: { value },
  });
  return bundle;
}

export async function clearOrgCookies(orgId: string, platform: SessionPlatform): Promise<void> {
  await prisma.orgSetting.deleteMany({ where: { organizationId: orgId, key: cookieKey(platform) } });
}

export async function getXHandle(orgId: string): Promise<string | null> {
  const row = await prisma.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: X_HANDLE_KEY } },
  });
  return row?.value || null;
}

export async function setXHandle(orgId: string, handle: string | null): Promise<void> {
  if (!handle) {
    await prisma.orgSetting.deleteMany({ where: { organizationId: orgId, key: X_HANDLE_KEY } });
    return;
  }
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: X_HANDLE_KEY } },
    create: { organizationId: orgId, key: X_HANDLE_KEY, value: handle },
    update: { value: handle },
  });
}

/** "@Foo", "x.com/Foo", "https://twitter.com/Foo/" → "Foo". Null if not a valid handle. */
export function normalizeXHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  const m = s.match(/(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

/**
 * The X session to use for a given connection: its workspace's session first
 * (always the freshest — the extension refreshes it on every run), else
 * whatever was pasted on the connection itself before v4.8.0.
 */
export async function xSessionForConnection(
  connectionId: string,
  tokenReference: string | null,
): Promise<{ authToken: string; ct0: string } | null> {
  try {
    const conn = await prisma.platformConnection.findUnique({
      where: { id: connectionId },
      select: { organizationId: true },
    });
    if (conn?.organizationId) {
      const b = await getOrgCookies(conn.organizationId, "TWITTER");
      if (b.cookies.auth_token && b.cookies.ct0) {
        return { authToken: b.cookies.auth_token, ct0: b.cookies.ct0 };
      }
    }
  } catch {
    // fall through to the connection's own value
  }
  if (!tokenReference) return null;
  try {
    const p = JSON.parse(tokenReference);
    if (p?.authToken && p?.ct0) return { authToken: String(p.authToken), ct0: String(p.ct0) };
  } catch {}
  return null;
}
