/**
 * The RAW Prisma client — no tenant scoping whatsoever.
 *
 * Almost nothing should import this. The client every route uses is the
 * auto-scoping one in db.ts, which wraps this. Import db-raw only where there
 * is genuinely no tenant to scope by, or where scoping would be wrong:
 *
 *   - scoped-db.ts, which builds the scoped client out of this one (importing
 *     the scoped client here would recurse forever);
 *   - tenancy.ts, whose whole job is to find rows that belong to NO
 *     organization yet and adopt them — a scoped client cannot see those.
 *
 * Everything else — routes, cron jobs, the extension endpoints, the auth
 * callbacks — imports "@/lib/db" and gets the right behaviour automatically.
 *
 * Configured for the Cloudflare Pages edge runtime:
 *
 * Two changes vs. the previous WebSocket-Pool wiring (which was the source
 * of the random 1101 / 1102 cold-isolate failures we kept band-aiding):
 *
 *   1. neonConfig.poolQueryViaFetch = true — makes every query run over a
 *      fresh HTTPS fetch instead of a persistent WebSocket. The WebSocket
 *      pool was sticking around in the global isolate cache; when the
 *      isolate got evicted and respun, the cached client referenced a dead
 *      socket and the next query crashed the worker (CF error 1101). With
 *      poolQueryViaFetch, there's nothing to keep alive — every query is
 *      stateless.
 *
 *   2. No globalForPrisma cache. We create a fresh PrismaClient per
 *      module-resolution. With HTTP transport there's nothing to reuse,
 *      and the cache is exactly what made stale isolates fail.
 *
 * Initialization is still lazy (via Proxy) so the module can be imported
 * at build time without DATABASE_URL being present.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig, Pool } from "@neondatabase/serverless";

// Route every Pool query through HTTPS fetch. Equivalent to using the
// neon() HTTP driver, but compatible with the existing PrismaNeon adapter
// that expects a Pool.
neonConfig.poolQueryViaFetch = true;

// In Node.js (local dev / CI), the WS polyfill is needed only when a
// query actually uses a WebSocket. With poolQueryViaFetch the polyfill
// is dead code on edge, but Prisma's listConnect probes may still call
// it. Keep the fallback for safety.
if (typeof globalThis.WebSocket === "undefined") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    neonConfig.webSocketConstructor = require("ws") as any;
  } catch {
    /* ws not installed — only an issue if a WS-only query actually fires */
  }
}

function buildClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter });
}

// Lazy proxy — actual client is constructed on first property access at
// runtime (defers DATABASE_URL evaluation until a request fires). Unlike
// the previous version we do NOT cache across isolates: each new isolate
// gets its own client, and since HTTP queries are stateless that costs us
// nothing.
let cached: PrismaClient | null = null;
const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!cached) cached = buildClient();
    const client = cached;
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});

export default prisma;
export { prisma };
