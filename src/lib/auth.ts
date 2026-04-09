/**
 * Auth helpers for Next.js App Router (edge-compatible).
 *
 * Uses `next-auth/jwt`'s `getToken` + `next/headers` cookies instead of
 * `getServerSession` from `next-auth/next`.  This avoids bundling openid-client
 * into edge functions, which would fail because the edge runtime's `node:util`
 * doesn't expose `util.inspect.custom`.
 */
import { getToken } from "next-auth/jwt";
import { cookies } from "next/headers";
import { UserRole } from "@prisma/client";

export { authOptions } from "@/app/api/auth/[...nextauth]/options";

/**
 * Reads the JWT token from the current request's cookies.
 * Works in both Server Components and Edge Route Handlers.
 */
async function getTokenFromCookies() {
  const cookieStore = await cookies();

  // Build a minimal request-like object that getToken understands.
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  // next-auth/jwt reads from req.cookies or from req.headers.cookie
  const fakeReq = {
    headers: {
      cookie: cookieHeader,
    },
    cookies: Object.fromEntries(
      cookieStore.getAll().map((c) => [c.name, c.value])
    ),
  } as Parameters<typeof getToken>[0]["req"];

  return getToken({
    req: fakeReq,
    secret: process.env.NEXTAUTH_SECRET!,
  });
}

/**
 * Returns the current session user, or null if not authenticated.
 * Usable in Server Components, Layouts, and Edge Route Handlers.
 */
export async function getSession() {
  const token = await getTokenFromCookies();
  if (!token) return null;
  return {
    user: {
      id: token.id as string | undefined,
      name: token.name as string | undefined,
      email: token.email as string | undefined,
      role: token.role as UserRole | undefined,
    },
  };
}

/**
 * Asserts the request is authenticated.
 * Throws "UNAUTHORIZED" if not logged in.
 */
export async function requireAuth() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  return session.user as { id?: string; name?: string; email?: string; role?: UserRole };
}

/**
 * Asserts the caller has at least `minRole`.
 * Throws "UNAUTHORIZED" or "FORBIDDEN" otherwise.
 */
export async function requireRole(minRole: UserRole) {
  const user = await requireAuth();
  const rolePriority: Record<UserRole, number> = {
    [UserRole.READ_ONLY]: 0,
    [UserRole.OPERATIONS]: 1,
    [UserRole.ADMIN]: 2,
  };

  if (rolePriority[user.role as UserRole] < rolePriority[minRole]) {
    throw new Error("FORBIDDEN");
  }

  return user;
}
