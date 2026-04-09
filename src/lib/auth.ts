import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import { UserRole } from "@prisma/client";

export { authOptions };

/**
 * Get the current session user from a server component or API route.
 */
export async function getSession() {
  return getServerSession(authOptions);
}

/**
 * Assert that the request has a valid session.
 * Returns the session user, or throws an unauthorized response.
 */
export async function requireAuth() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  return session.user;
}

/**
 * Assert that the current user has at least the given role.
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

/**
 * Standard error response helper for API routes.
 */
export function authError(type: "UNAUTHORIZED" | "FORBIDDEN") {
  const status = type === "UNAUTHORIZED" ? 401 : 403;
  const message = type === "UNAUTHORIZED" ? "Authentication required" : "Insufficient permissions";
  return Response.json({ success: false, error: message }, { status });
}
