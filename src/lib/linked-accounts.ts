/**
 * Linked Accounts (v4.60.0) — the CloudCampaign way of publishing.
 *
 * RULE (Olivier, 2026-10-21): publishing starts with connecting each company's
 * LinkedIn and X accounts in Settings. The owner of the account logs in on
 * LinkedIn / X itself (OAuth) and allows social.gershon.ai to post; the app
 * never sees a password. Posts then go out from the server through the
 * official APIs, and the API returns the post's id — so the direct link on
 * each post is exact.
 *
 *  - LinkedIn: the "Gershon Social Publisher" developer app (Community
 *    Management API — it must be the only product on that app). A page admin
 *    connects; they pick which page (or their own profile) to post as.
 *  - X: an X developer app (OAuth 2.0 with PKCE), one connection per handle.
 *  - A company without a connection keeps publishing through the Chrome
 *    extension, exactly as before. LinkedIn groups always use the extension
 *    (the API cannot post in groups).
 *
 * Storage (no schema change): OrgSetting `linked:<clientId>` holds the
 * connections, sealed with AES-GCM (key from NEXTAUTH_SECRET, see x-session).
 * The developer-app keys live in the global Setting table (`publish_app_*`,
 * sealed) or in env (LINKEDIN_PUBLISH_CLIENT_ID/SECRET, X_CLIENT_ID/SECRET).
 */
import prisma from "@/lib/db-raw";
import { openValue, sealValue } from "@/lib/x-session";
import { SITE } from "@/lib/publishing";

export type LinkNet = "linkedin" | "x";
export type LiAuthor = { urn: string; name: string; kind: "organization" | "person"; vanity: string | null; id: string };
export type LiConn = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  refreshExpiresAt: string | null;
  memberUrn: string | null;
  connectedBy: string | null;
  connectedAt: string;
  authors: LiAuthor[];
  /** The page or profile posts go out as. */
  author: string | null;
  lastError: string | null;
};
export type XConn = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  userId: string;
  username: string;
  name: string | null;
  connectedBy: string | null;
  connectedAt: string;
  lastError: string | null;
};
export type Linked = { linkedin?: LiConn | null; x?: XConn | null };

// ── Developer-app keys ───────────────────────────────────────────────────────

/** "Gershon Social Publisher" (LinkedIn app 266649415), created 2026-10-21. The client ID is public. */
export const DEFAULT_LI_CLIENT_ID = "78dytmirdwt7l5";
const APP_KEY = (net: LinkNet) => `publish_app_${net}`;

export type AppCreds = { clientId: string | null; clientSecret: string | null; source: "env" | "settings" | "default" | "none" };

export async function getAppCreds(net: LinkNet): Promise<AppCreds> {
  const envId = net === "linkedin" ? process.env.LINKEDIN_PUBLISH_CLIENT_ID : process.env.X_CLIENT_ID;
  const envSecret = net === "linkedin" ? process.env.LINKEDIN_PUBLISH_CLIENT_SECRET : process.env.X_CLIENT_SECRET;
  if (envId && (envSecret || net === "x")) return { clientId: envId, clientSecret: envSecret || null, source: "env" };
  const row = await prisma.setting.findUnique({ where: { key: APP_KEY(net) } });
  if (row?.value) {
    try {
      const v = JSON.parse((await openValue(row.value)) || "{}") as { clientId?: string; clientSecret?: string };
      if (v.clientId) return { clientId: v.clientId, clientSecret: v.clientSecret || null, source: "settings" };
    } catch { /* fall through */ }
  }
  if (net === "linkedin") return { clientId: DEFAULT_LI_CLIENT_ID, clientSecret: null, source: "default" };
  return { clientId: null, clientSecret: null, source: "none" };
}

export async function saveAppCreds(net: LinkNet, clientId: string, clientSecret: string | null): Promise<void> {
  const cur = await getAppCreds(net);
  const value = await sealValue(JSON.stringify({ clientId: clientId.trim(), clientSecret: (clientSecret || "").trim() || (cur.source === "settings" ? cur.clientSecret : null) }));
  await prisma.setting.upsert({ where: { key: APP_KEY(net) }, create: { key: APP_KEY(net), value }, update: { value } });
}

/** Ready to connect: LinkedIn needs id + secret; X needs an id (secret only for confidential apps). */
export function appReady(net: LinkNet, c: AppCreds): boolean {
  return !!c.clientId && (net === "x" || !!c.clientSecret);
}

export function redirectUri(net: LinkNet): string {
  return `${SITE}/api/publishing/oauth/${net}/callback`;
}

// ── Connections ──────────────────────────────────────────────────────────────

const LINK_KEY = (clientId: string) => `linked:${clientId}`;

export async function getLinked(orgId: string, clientId: string): Promise<Linked> {
  const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: LINK_KEY(clientId) } } });
  if (!row?.value) return {};
  try {
    return JSON.parse((await openValue(row.value)) || "{}") as Linked;
  } catch {
    return {};
  }
}

export async function saveLinked(orgId: string, clientId: string, l: Linked): Promise<void> {
  const value = await sealValue(JSON.stringify(l));
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: LINK_KEY(clientId) } },
    create: { organizationId: orgId, key: LINK_KEY(clientId), value },
    update: { value },
  });
}

// ── OAuth state (one-time, 15 minutes) ───────────────────────────────────────

type OAuthState = { orgId: string; clientId: string; net: LinkNet; verifier: string | null; by: string | null; at: number };
const STATE_KEY = (s: string) => `oauth_state:${s}`;

function rand(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function newState(orgId: string, clientId: string, net: LinkNet, by: string | null): Promise<{ state: string; challenge: string | null }> {
  const state = rand(16);
  const verifier = net === "x" ? b64url(crypto.getRandomValues(new Uint8Array(48))) : null;
  const st: OAuthState = { orgId, clientId, net, verifier, by, at: Date.now() };
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: STATE_KEY(state) } },
    create: { organizationId: orgId, key: STATE_KEY(state), value: JSON.stringify(st) },
    update: { value: JSON.stringify(st) },
  });
  const challenge = verifier ? b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))) : null;
  return { state, challenge };
}

export async function takeState(state: string): Promise<OAuthState | null> {
  if (!/^[a-f0-9]{32}$/.test(state)) return null;
  const row = await prisma.orgSetting.findFirst({ where: { key: STATE_KEY(state) } });
  if (!row) return null;
  await prisma.orgSetting.deleteMany({ where: { key: STATE_KEY(state) } });
  try {
    const st = JSON.parse(row.value) as OAuthState;
    return Date.now() - st.at < 15 * 60000 ? st : null;
  } catch {
    return null;
  }
}

// ── LinkedIn API ─────────────────────────────────────────────────────────────

/** LinkedIn versions are monthly (YYYYMM) and retire after ~1 year: newest first, the next is tried on 426. */
const LI_VERSIONS = ["202609", "202606", "202603", "202512"];
export const LI_SCOPES = "w_member_social w_organization_social r_organization_social rw_organization_admin";

export function linkedinAuthorizeUrl(clientId: string, state: string): string {
  const p = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri("linkedin"), state, scope: LI_SCOPES });
  return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
}

export async function liFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  let last: Response | null = null;
  for (const v of LI_VERSIONS) {
    const r = await fetch(`https://api.linkedin.com/rest/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "LinkedIn-Version": v, "X-Restli-Protocol-Version": "2.0.0", ...(init.headers || {}) },
    });
    if (r.status !== 426) return r;
    last = r;
  }
  return last as Response;
}

async function liToken(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }> {
  const r = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !j.access_token) throw new Error(`LinkedIn refused the connection: ${String(j.error_description || j.error || r.status)}`);
  return j as never;
}

/** Pages the member administers, plus their own profile. */
async function liAuthors(token: string): Promise<{ memberUrn: string | null; authors: LiAuthor[] }> {
  const authors: LiAuthor[] = [];
  let memberUrn: string | null = null;
  const r = await liFetch(token, "organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50");
  if (r.ok) {
    const j = (await r.json()) as { elements?: { organization?: string; organizationTarget?: string; roleAssignee?: string }[] };
    for (const e of j.elements || []) {
      memberUrn = memberUrn || e.roleAssignee || null;
      const urn = e.organization || e.organizationTarget;
      if (!urn) continue;
      const id = urn.split(":").pop() as string;
      let name = `Page ${id}`, vanity: string | null = null;
      const o = await liFetch(token, `organizations/${id}`);
      if (o.ok) {
        const oj = (await o.json()) as { localizedName?: string; vanityName?: string };
        name = oj.localizedName || name;
        vanity = oj.vanityName || null;
      }
      authors.push({ urn, name, kind: "organization", vanity, id });
    }
  }
  if (memberUrn) authors.push({ urn: memberUrn, name: "Personal profile", kind: "person", vanity: null, id: memberUrn.split(":").pop() as string });
  return { memberUrn, authors };
}

export async function linkedinConnect(code: string, by: string | null, prev: LiConn | null | undefined): Promise<LiConn> {
  const app = await getAppCreds("linkedin");
  if (!appReady("linkedin", app)) throw new Error("The LinkedIn publishing app's Client Secret is not set (Settings → Linked accounts → Publishing apps).");
  const t = await liToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri("linkedin"), client_id: app.clientId!, client_secret: app.clientSecret! });
  const now = Date.now();
  const { memberUrn, authors } = await liAuthors(t.access_token);
  const keep = prev?.author && authors.some((a) => a.urn === prev.author) ? prev.author : null;
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || null,
    expiresAt: new Date(now + t.expires_in * 1000).toISOString(),
    refreshExpiresAt: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000).toISOString() : null,
    memberUrn,
    connectedBy: by,
    connectedAt: new Date(now).toISOString(),
    authors,
    author: keep || authors.find((a) => a.kind === "organization")?.urn || authors[0]?.urn || null,
    lastError: null,
  };
}

/** A fresh access token (refreshes when it expires within 5 days). */
export async function linkedinToken(c: LiConn): Promise<{ token: string; updated: LiConn | null }> {
  if (new Date(c.expiresAt).getTime() - Date.now() > 5 * 86400000 || !c.refreshToken) return { token: c.accessToken, updated: null };
  const app = await getAppCreds("linkedin");
  if (!appReady("linkedin", app)) return { token: c.accessToken, updated: null };
  const t = await liToken({ grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: app.clientId!, client_secret: app.clientSecret! });
  const now = Date.now();
  const updated: LiConn = {
    ...c,
    accessToken: t.access_token,
    refreshToken: t.refresh_token || c.refreshToken,
    expiresAt: new Date(now + t.expires_in * 1000).toISOString(),
    refreshExpiresAt: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000).toISOString() : c.refreshExpiresAt,
  };
  return { token: t.access_token, updated };
}

/** LinkedIn "little text": reserved characters escaped, #words kept as hashtags. */
export function liCommentary(text: string): string {
  const esc = (s: string) => s.replace(/[\\|{}@\[\]()<>#*_~]/g, (m) => "\\" + m);
  return text
    .split(/(#[\p{L}\p{N}_]+)/u)
    .map((part) => (/^#[\p{L}\p{N}_]+$/u.test(part) ? `{hashtag|\\#|${esc(part.slice(1))}}` : esc(part)))
    .join("");
}

async function liUploadImage(token: string, owner: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string> {
  const r = await liFetch(token, "images?action=initializeUpload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  const j = (await r.json().catch(() => ({}))) as { value?: { uploadUrl?: string; image?: string }; message?: string };
  if (!r.ok || !j.value?.uploadUrl || !j.value.image) throw new Error(`LinkedIn picture upload refused: ${j.message || r.status}`);
  const up = await fetch(j.value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": mime }, body: bytes });
  if (!up.ok) throw new Error(`LinkedIn picture upload failed (${up.status}).`);
  return j.value.image;
}

/** Publish one post. Returns its URL. `sent` tells whether LinkedIn may have created it (never retry then). */
export async function linkedinPost(c: LiConn, token: string, text: string, picture: { bytes: Uint8Array<ArrayBuffer>; mime: string } | null): Promise<{ url: string; id: string }> {
  if (!c.author) throw new Error("Pick which LinkedIn page to post as (Settings → Linked accounts).");
  const imageUrn = picture ? await liUploadImage(token, c.author, picture.bytes, picture.mime) : null;
  const body = {
    author: c.author,
    commentary: liCommentary(text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
    ...(imageUrn ? { content: { media: { id: imageUrn } } } : {}),
  };
  const r = await liFetch(token, "posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status !== 201) {
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    const err = new Error(`LinkedIn refused the post: ${j.message || r.status}`);
    (err as Error & { sent?: boolean }).sent = r.status >= 500;
    throw err;
  }
  const urn = r.headers.get("x-restli-id") || r.headers.get("x-linkedin-id") || "";
  return { id: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "" };
}

// ── X API ────────────────────────────────────────────────────────────────────

export const X_SCOPES = "tweet.read tweet.write users.read media.write offline.access";

export function xAuthorizeUrl(clientId: string, state: string, challenge: string): string {
  const p = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri("x"), scope: X_SCOPES, state,
    code_challenge: challenge, code_challenge_method: "S256",
  });
  return `https://x.com/i/oauth2/authorize?${p}`;
}

async function xToken(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const app = await getAppCreds("x");
  if (!app.clientId) throw new Error("The X publishing app is not set (Settings → Linked accounts → Publishing apps).");
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (app.clientSecret) headers.Authorization = "Basic " + btoa(`${app.clientId}:${app.clientSecret}`);
  const r = await fetch("https://api.x.com/2/oauth2/token", { method: "POST", headers, body: new URLSearchParams({ client_id: app.clientId, ...body }).toString() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !j.access_token) throw new Error(`X refused the connection: ${String(j.error_description || j.error || r.status)}`);
  return j as never;
}

export async function xConnect(code: string, verifier: string, by: string | null): Promise<XConn> {
  const t = await xToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri("x"), code_verifier: verifier });
  const me = await fetch("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${t.access_token}` } });
  const mj = (await me.json().catch(() => ({}))) as { data?: { id: string; username: string; name?: string } };
  if (!mj.data) throw new Error("X did not say which account was connected.");
  const now = Date.now();
  return {
    accessToken: t.access_token, refreshToken: t.refresh_token || null, expiresAt: new Date(now + t.expires_in * 1000).toISOString(),
    userId: mj.data.id, username: mj.data.username, name: mj.data.name || null, connectedBy: by, connectedAt: new Date(now).toISOString(), lastError: null,
  };
}

/** X tokens last 2 hours: refresh when under 10 minutes left. */
export async function xTokenFresh(c: XConn): Promise<{ token: string; updated: XConn | null }> {
  if (new Date(c.expiresAt).getTime() - Date.now() > 10 * 60000 || !c.refreshToken) return { token: c.accessToken, updated: null };
  const t = await xToken({ grant_type: "refresh_token", refresh_token: c.refreshToken });
  const updated: XConn = { ...c, accessToken: t.access_token, refreshToken: t.refresh_token || c.refreshToken, expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString() };
  return { token: t.access_token, updated };
}

export async function xPost(c: XConn, token: string, text: string, picture: { bytes: Uint8Array<ArrayBuffer>; mime: string } | null): Promise<{ url: string; id: string }> {
  let mediaId: string | null = null;
  if (picture) {
    const fd = new FormData();
    fd.append("media", new Blob([picture.bytes], { type: picture.mime }), picture.mime === "image/png" ? "picture.png" : "picture.jpg");
    fd.append("media_category", "tweet_image");
    const m = await fetch("https://api.x.com/2/media/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const mj = (await m.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
    if (!m.ok || !mj.data?.id) throw new Error(`X picture upload refused: ${mj.detail || mj.title || m.status}`);
    mediaId = mj.data.id;
  }
  const r = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: { id: string }; detail?: string; title?: string };
  if (!r.ok || !j.data?.id) {
    const err = new Error(`X refused the post: ${j.detail || j.title || r.status}`);
    (err as Error & { sent?: boolean }).sent = r.status >= 500;
    throw err;
  }
  return { id: j.data.id, url: `https://x.com/${c.username}/status/${j.data.id}` };
}

// ── Which delivery goes through the API ──────────────────────────────────────

/** The LinkedIn connection posts this delivery when its chosen page matches the delivery's target. */
export function liMatches(c: LiConn | null | undefined, target: string | null): boolean {
  if (!c?.author || !target) return false;
  const a = c.authors.find((x) => x.urn === c.author);
  if (!a) return false;
  if (/\/groups\//i.test(target)) return false; // groups: extension only
  if (a.kind === "person") return /\/in\//i.test(target);
  const m = target.match(/linkedin\.com\/(?:company|showcase)\/([^/?#]+)/i);
  if (!m) return false;
  const slug = decodeURIComponent(m[1]).toLowerCase();
  return slug === a.id || (!!a.vanity && slug === a.vanity.toLowerCase());
}
export function xMatches(c: XConn | null | undefined, target: string | null): boolean {
  return !!c && !!target && c.username.toLowerCase() === target.replace(/^@/, "").toLowerCase();
}

export function liAuthorUrl(a: LiAuthor | undefined): string | null {
  if (!a || a.kind !== "organization") return null;
  return `https://www.linkedin.com/company/${a.vanity || a.id}/`;
}
