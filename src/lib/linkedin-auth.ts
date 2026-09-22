/**
 * Edge-safe LinkedIn *login* (Sign In with LinkedIn / OpenID Connect).
 *
 * This deployment stubs out `openid-client` and disables http/https in
 * webpack (see next.config.ts), so NextAuth's built-in OAuth providers can't
 * run on the edge — only CredentialsProvider works. So we implement LinkedIn
 * sign-in as a plain `fetch`-based OAuth flow (the same approach the client
 * "connect" flow already uses) and then mint the *same* NextAuth JWT session
 * cookie that getToken() reads, so the rest of the app treats a LinkedIn
 * login exactly like a credentials login.
 */
import { encode } from "next-auth/jwt";
import { UserRole } from "@prisma/client";

const SESSION_MAX_AGE = 8 * 60 * 60; // 8h — must match authOptions.session.maxAge

export type LinkedInProfile = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

/** LinkedIn OIDC scopes for sign-in. Requires the "Sign In with LinkedIn using OpenID Connect" product. */
export const LOGIN_SCOPES = "openid profile email";

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";
}

/**
 * The LinkedIn app (client 787cqonyq6vpd0) has exactly ONE authorized redirect
 * URL: /api/auth/linkedin/callback. Attempts to register a second one for the
 * sign-in flow did not persist, and LinkedIn rejects any other value with
 * "redirect_uri does not match the registered value".
 *
 * So BOTH flows come back through this single URL and the `state` parameter
 * says which one it was: `{ mode: "login" }` for sign-in, anything else
 * (clientId/connectionId) for connecting a client's LinkedIn page.
 */
export function connectRedirectUri(): string {
  return `${appUrl()}/api/auth/linkedin/callback`;
}

export function loginRedirectUri(): string {
  return connectRedirectUri();
}

/** Legacy URL kept working in case it is ever registered in the portal. */
export function legacyLoginRedirectUri(): string {
  return `${appUrl()}/api/auth/linkedin/login/callback`;
}

/**
 * Who may be provisioned as an ADMIN by signing in with LinkedIn.
 *
 * The old rule was "only when no ADMIN exists at all" — but production is
 * seeded with an admin, so every real first-time LinkedIn sign-in was rejected
 * with "isn't invited yet". This is the lockout that made the feature unusable.
 *
 * Defaults cover Gershon's own domains plus the owner's personal address.
 * Override with ADMIN_LINKEDIN_DOMAINS (comma-separated, no @) and/or
 * ADMIN_LINKEDIN_EMAILS (comma-separated). Neither needs a new secret.
 */
const DEFAULT_ADMIN_DOMAINS = ["gershonconsulting.com", "gershon.ai"];
const DEFAULT_ADMIN_EMAILS = ["oattia@gmail.com"];

function csv(v: string | undefined): string[] {
  return (v || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAdminEmail(email: string): boolean {
  const e = email.toLowerCase().trim();
  if (!e.includes("@")) return false;

  const envEmails = csv(process.env.ADMIN_LINKEDIN_EMAILS);
  const emails = envEmails.length ? envEmails : DEFAULT_ADMIN_EMAILS;
  if (emails.includes(e)) return true;

  const envDomains = csv(process.env.ADMIN_LINKEDIN_DOMAINS).map((d) => d.replace(/^@/, ""));
  const domains = envDomains.length ? envDomains : DEFAULT_ADMIN_DOMAINS;
  return domains.includes(e.slice(e.lastIndexOf("@") + 1));
}

/** Cookie name NextAuth (and our getToken) expects, given http vs https. */
export function sessionCookieName(): string {
  const secure = (process.env.NEXTAUTH_URL || appUrl()).startsWith("https://");
  return secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

/** Exchange an authorization code for an access token. */
export async function exchangeCode(code: string, redirectUri?: string): Promise<string> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri ?? loginRedirectUri(),
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token exchange failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token in LinkedIn response");
  return data.access_token;
}

/** Fetch the OIDC userinfo (sub, email, name, picture). */
export async function fetchProfile(accessToken: string): Promise<LinkedInProfile> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`userinfo failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const j = (await res.json()) as LinkedInProfile;
  if (!j.sub) throw new Error("LinkedIn userinfo missing 'sub'");
  return j;
}

/**
 * Mint an encrypted NextAuth session JWT for a resolved app user.
 * The token shape mirrors what authOptions' jwt/session callbacks produce,
 * so getToken()/getSession() read id, role, name, email consistently.
 */
export async function mintSessionToken(user: {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  image?: string | null;
}): Promise<string> {
  return encode({
    token: {
      sub: user.id,
      id: user.id,
      name: user.name ?? undefined,
      email: user.email,
      picture: user.image ?? undefined,
      role: user.role,
    },
    secret: process.env.NEXTAUTH_SECRET as string,
    maxAge: SESSION_MAX_AGE,
  });
}

export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE;
