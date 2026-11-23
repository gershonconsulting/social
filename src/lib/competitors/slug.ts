import rawDb from "@/lib/db-raw";
import { pickFreeSlug } from "./slug-core";

/**
 * v4.83.1: a Client.slug that no company in ANY workspace uses yet.
 * Client.slug is globally unique, so the check must not be tenant-scoped.
 * Only ids are read.
 */
export function freeClientSlug(base: string): Promise<string> {
  return pickFreeSlug(base, async (slug) => !!(await rawDb.client.findFirst({ where: { slug }, select: { id: true } })));
}
