/**
 * Prisma client configured for Cloudflare Pages edge runtime.
 *
 * Uses Neon's serverless HTTP driver instead of TCP so the client
 * works in edge environments (Cloudflare Workers / Pages Functions).
 *
 * Initialization is lazy (via Proxy) so the module can be imported at
 * build time without DATABASE_URL being present.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig, Pool } from "@neondatabase/serverless";

// In Node.js (local dev / CI), use WebSocket polyfill; in edge, native WS is used
if (typeof globalThis.WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  neonConfig.webSocketConstructor = require("ws") as any;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter });
}

// Lazy proxy — actual client is created on first property access at runtime.
// This prevents the module from throwing during Next.js build-time evaluation.
const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = buildClient();
    }
    const client = globalForPrisma.prisma;
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});

export default prisma;
export { prisma };
