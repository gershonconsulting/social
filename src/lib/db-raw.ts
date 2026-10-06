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
 *   1. neonConfig.poolQueryViaFetch = true — makes every query run over a
 *      fresh HTTPS fetch instead of a persistent WebSocket. The WebSocket
 *      pool was sticking around in the global isolate cache; when the
 *      isolate got evicted and respun, the cached client referenced a dead
 *      socket and the next query crashed the worker (CF error 1101). With
 *      poolQueryViaFetch, there's nothing to keep alive — every query is
 *      stateless.
 *
 *   2. v4.33.0: ONE client per isolate, kept on globalThis and shared by
 *      every route bundle — see the note above shared() below.
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

// ONE client per isolate, shared by every route bundle (v4.33.0).
//
// next-on-pages compiles each route into its own bundle, each with its own
// copy of this module. A module-scoped cache therefore meant one PrismaClient
// — and one instance of the 2 MB query-engine WASM, with the whole schema
// loaded into it — PER ROUTE that an isolate happened to serve. Audit of
// 2026-10-06 reproduced it on demand: three different API routes in a row
// succeed, the fourth dies with 1102 "Worker exceeded resource limits", and
// every request to that isolate afterwards is 1101 "Worker threw exception".
// That is the "most unreliable platform" symptom: pages that load several
// APIs (Dashboard, Logs, Settings) exhaust the isolate's memory.
//
// globalThis IS shared between those bundles inside one isolate, so the
// client lives there. With poolQueryViaFetch every query is a stateless
// HTTPS fetch, so sharing it holds no socket that could go stale (the reason
// the old global cache was removed).
const GLOBAL_KEY = "__gershonPrismaRaw__";
type G = typeof globalThis & { [GLOBAL_KEY]?: PrismaClient };

function shared(): PrismaClient {
  const g = globalThis as G;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = buildClient();
  return g[GLOBAL_KEY] as PrismaClient;
}

const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = shared();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});

export default prisma;
export { prisma };
