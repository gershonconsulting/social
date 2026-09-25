/**
 * The CURRENT role / workspace / active flag of a signed-in user.
 *
 * The session JWT is minted at sign-in and lives for weeks, so anything read
 * from it goes stale the moment an admin changes that person: moving them to
 * their own workspace, changing their role, deactivating them. Before this
 * existed, a user moved out of the Gershon workspace kept reading Gershon's
 * data until their token expired. Every authorization decision now reads the
 * row instead — one indexed lookup, cached 10s per user per isolate.
 *
 * Uses the raw client on purpose: the User table is not tenant-scoped, and
 * importing the scoped client here would recurse (it resolves the caller
 * through this very file).
 */
import prisma from "@/lib/db-raw";
import type { UserRole } from "@prisma/client";

export type FreshUser = {
  role: UserRole;
  organizationId: string | null;
  isActive: boolean;
};

const cache = new Map<string, { value: FreshUser | null; at: number }>();
const TTL_MS = 10_000;
const MAX = 128;

export async function freshUser(userId: string): Promise<FreshUser | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, organizationId: true, isActive: true },
  });
  const value: FreshUser | null = row
    ? { role: row.role, organizationId: row.organizationId, isActive: row.isActive }
    : null;

  if (cache.size >= MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(userId, { value, at: Date.now() });
  return value;
}

/** Drop a cached entry right after an admin changes that user. */
export function forgetUser(userId: string): void {
  cache.delete(userId);
}
