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

export function loginRedirectUri(): string {
  return `${appUrl()}/api/auth/linkedin/login/callback`;
}

/** Cookie name NextAuth (and our getToken) expects, given http vs https. */
export function sessionCookieName(): string {
  const secure = (process.env.NEXTAUTH_URL || appUrl()).startsWith("https://");
  return secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

/** Exchange an authorization code for an access token. */
export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: loginRedirectUri(),
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
