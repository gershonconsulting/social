/**
 * Prisma-free database access over Neon's HTTP driver.
 *
 * WHY. On Cloudflare's edge runtime, the first Prisma query in a cold isolate
 * instantiates the 2 MB Prisma query-engine WASM. That costs more CPU than a
 * Worker request is allowed, and the request dies with Error 1102 "Worker
 * exceeded resource limits" (root cause confirmed 2026-08-21). The LinkedIn
 * sign-in callback is the worst place for that to happen: a user who has just
 * approved LinkedIn lands on a Cloudflare error page instead of the dashboard.
 *
 * So the hot, small paths that must never fail — sign-in first — talk to
 * Postgres directly with a single HTTPS fetch per query. No engine, no WASM.
 *
 * Column names are the Prisma field names (camelCase, so they must be quoted);
 * table names come from @@map. Prisma fills `id` (cuid) and `updatedAt` in the
 * client, not the database, so callers here must supply both.
 */
import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;
let cached: Sql | null = null;

export function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL environment variable is not set");
    cached = neon(url);
  }
  return cached;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Parameterised query ($1, $2 …) returning plain rows. */
export async function query<T = Record<string, any>>(text: string, params: unknown[] = []): Promise<T[]> {
  const run = sql() as unknown as (t: string, p: unknown[]) => Promise<T[]>;
  return run(text, params);
}

/** A collision-resistant string id, compatible with the cuid-shaped ids Prisma writes. */
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 18);
  return `c${Date.now().toString(36)}${rand}`;
}
