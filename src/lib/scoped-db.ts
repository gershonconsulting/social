/**
 * The tenant scope filter.
 *
 * Multi-tenancy is only as good as its least careful query. There are 229
 * database call sites in this app; hand-writing `where: { organizationId }` at
 * every one of them is a guarantee that somebody eventually forgets, and a
 * forgotten filter is not a bug that shows up in testing — it is one tenant
 * silently reading another tenant's client book.
 *
 * So the filter is applied in ONE place: a Prisma client extension that
 * rewrites every query against a tenant-scoped model before it reaches the
 * database. Route code writes ordinary Prisma against "@/lib/db", unaware that
 * anything is happening — db.ts picks the scoped client automatically.
 *
 * What gets rewritten, per operation:
 *   reads      — organizationId is merged into `where`.
 *   findUnique — becomes findFirst. This matters: findUnique takes only unique
 *                fields, so there is no way to add a scope to it, which would
 *                make `findUnique({ where: { id } })` readable across tenants
 *                by anyone who knows an id. Converting is the whole point.
 *   create     — organizationId is stamped onto `data`.
 *   update /
 *   delete /
 *   upsert     — Prisma requires a UNIQUE where here, so the scope cannot be
 *                merged in. Instead the row's ownership is checked first and
 *                the operation is refused if it belongs to someone else. That
 *                costs one extra indexed read on writes, which at this scale is
 *                not worth optimising away for a correctness guarantee.
 *
 * NOT scoped, deliberately: User (it carries organizationId but is read by the
 * auth layer before any org is known), Organization itself, and the global
 * Setting table.
 *
 * NOT scoped, and a known gap: $queryRaw. Raw SQL goes straight to the
 * database without passing through the extension, so every raw query needs its
 * own organizationId predicate. Today the raw queries live in the daily report
 * and the diagnostics page, both of which are whole-deployment views.
 *
 * WHY THE SESSION IS READ HERE rather than imported from "@/lib/auth": auth.ts
 * re-exports authOptions, which pulls in the NextAuth options module, which
 * imports the database client — importing it from here would close a cycle
 * through db.ts. The token read below is the same nine lines, standing alone.
 */
import prisma from "@/lib/db-raw";
import { getToken } from "next-auth/jwt";
import { cookies } from "next/headers";

/** Models that carry organizationId and must never cross tenants. */
const SCOPED_MODELS = new Set([
  "Client",
  "PlatformConnection",
  "PostingSchedule",
  "SocialPost",
  "DailyCompliance",
  "FollowerSnapshot",
  "ContentAnalysis",
  "PostPrompt",
  "SyncJob",
  "AuditLog",
  "OrgSetting",
]);

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const UNIQUE_READ_OPS = new Set(["findUnique", "findUniqueOrThrow"]);
const GUARDED_WRITE_OPS = new Set(["update", "delete", "upsert"]);
const BULK_WRITE_OPS = new Set(["updateMany", "deleteMany"]);

/**
 * Who, if anyone, is making this request.
 *
 * `signedIn: false` is not an error — it is how cron jobs, the Chrome
 * extension endpoints and the sign-in callbacks all look. They have no tenant
 * to be scoped to and run against the raw client.
 *
 * `signedIn: true, orgId: null` IS a problem: somebody is authenticated but
 * belongs to no workspace. That must never quietly fall back to an unscoped
 * query, so db.ts throws on it.
 */
export type OrgResolution = { signedIn: boolean; orgId: string | null };

/**
 * Resolution cache, keyed by the session cookie itself.
 *
 * Every single query resolves the caller, and the NextAuth token is encrypted,
 * so without this a page that runs fifteen queries pays for fifteen JWE
 * decrypts. Keying on the cookie value — the credential itself — is what makes
 * the cache safe: two requests share an entry only if they present the exact
 * same session. The TTL keeps a revoked or re-minted session from lingering,
 * and the map is bounded because a Workers isolate is not ours to fill up.
 */
const resolutionCache = new Map<string, { value: OrgResolution; at: number }>();
const RESOLUTION_TTL_MS = 10_000;
const RESOLUTION_MAX = 64;

function cacheGet(key: string): OrgResolution | null {
  const hit = resolutionCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > RESOLUTION_TTL_MS) {
    resolutionCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: OrgResolution): OrgResolution {
  if (resolutionCache.size >= RESOLUTION_MAX) {
    const oldest = resolutionCache.keys().next().value;
    if (oldest !== undefined) resolutionCache.delete(oldest);
  }
  resolutionCache.set(key, { value, at: Date.now() });
  return value;
}

export async function resolveOrg(): Promise<OrgResolution> {
  let cookieHeader = "";
  let token: Record<string, unknown> | null = null;

  try {
    const store = await cookies();
    const all = store.getAll();
    // Only the session cookie identifies the caller; the rest is noise that
    // would fragment the cache.
    cookieHeader = all
      .filter((c) => c.name.includes("next-auth.session-token"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    if (!cookieHeader) return { signedIn: false, orgId: null };

    const cached = cacheGet(cookieHeader);
    if (cached) return cached;

    token = (await getToken({
      req: {
        headers: { cookie: all.map((c) => `${c.name}=${c.value}`).join("; ") },
        cookies: Object.fromEntries(all.map((c) => [c.name, c.value])),
      } as Parameters<typeof getToken>[0]["req"],
      secret: process.env.NEXTAUTH_SECRET as string,
    })) as Record<string, unknown> | null;
  } catch {
    // No request context at all (a build-time render, the standalone job
    // runner). Same shape as an anonymous caller.
    return { signedIn: false, orgId: null };
  }

  const userId = token?.id as string | undefined;
  if (!token || !userId) return cacheSet(cookieHeader, { signedIn: false, orgId: null });

  const fromToken = token.organizationId as string | undefined;
  if (fromToken) return cacheSet(cookieHeader, { signedIn: true, orgId: fromToken });

  // Sessions minted before v4.2.0 do not carry the org. One indexed read, and
  // it disappears the next time this person signs in.
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true },
  });
  return cacheSet(cookieHeader, { signedIn: true, orgId: row?.organizationId ?? null });
}

/** The organization the signed-in user belongs to, or null. */
export async function getCurrentOrgId(): Promise<string | null> {
  return (await resolveOrg()).orgId;
}

function mergeWhere(args: Record<string, unknown>, orgId: string): Record<string, unknown> {
  const where = (args.where ?? {}) as Record<string, unknown>;
  return { ...args, where: { ...where, organizationId: orgId } };
}

/**
 * A Prisma client that can only see one tenant's rows.
 *
 * Throws UNAUTHORIZED when nobody is signed in, and NO_ORGANIZATION when the
 * signed-in user has not been placed in a workspace. Both are deliberate: an
 * unscoped query is never the safe fallback.
 */
export async function scopedDb() {
  const { signedIn, orgId } = await resolveOrg();
  if (!signedIn) throw new Error("UNAUTHORIZED");
  if (!orgId) throw new Error("NO_ORGANIZATION");
  return dbForOrg(orgId);
}

/** One extended client per organization per isolate. $extends is not free. */
const clientsByOrg = new Map<string, ReturnType<typeof buildScoped>>();

/**
 * The same scoping, for a known organization id. Used by anything that resolves
 * its tenant some other way than a session — a per-org cron pass, say.
 */
export function dbForOrg(orgId: string) {
  const cached = clientsByOrg.get(orgId);
  if (cached) return cached;
  const built = buildScoped(orgId);
  clientsByOrg.set(orgId, built);
  return built;
}

function buildScoped(orgId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const a = (args ?? {}) as Record<string, unknown>;
          // The extension types `query` per operation; these rewrites are generic.
          const run = query as unknown as (x: unknown) => Promise<unknown>;

          if (READ_OPS.has(operation)) {
            return run(mergeWhere(a, orgId));
          }

          // findUnique cannot carry a scope, so read it as findFirst instead.
          if (UNIQUE_READ_OPS.has(operation)) {
            const row = await (
              prisma[toDelegate(model)] as unknown as {
                findFirst: (x: unknown) => Promise<unknown>;
              }
            ).findFirst(mergeWhere(a, orgId));
            if (!row && operation === "findUniqueOrThrow") {
              throw new Error(`No ${model} found`);
            }
            return row;
          }

          if (operation === "create") {
            const data = (a.data ?? {}) as Record<string, unknown>;
            return run({ ...a, data: { ...data, organizationId: orgId } });
          }

          if (operation === "createMany") {
            const data = a.data;
            const stamp = (d: unknown) => ({ ...(d as object), organizationId: orgId });
            return run({ ...a, data: Array.isArray(data) ? data.map(stamp) : stamp(data) });
          }

          if (BULK_WRITE_OPS.has(operation)) {
            return run(mergeWhere(a, orgId));
          }

          if (GUARDED_WRITE_OPS.has(operation)) {
            // Prisma demands a UNIQUE `where` here, so the scope cannot be
            // merged into it: the query would match another tenant's row by id
            // or by a unique key and happily write to it. So look the row up
            // first, unscoped, and decide.
            const where = (a.where ?? {}) as Record<string, unknown>;
            const existing = (await (
              prisma[toDelegate(model)] as unknown as {
                findFirst: (x: unknown) => Promise<unknown>;
              }
            ).findFirst({ where, select: { organizationId: true } })) as
              | { organizationId: string | null }
              | null;

            // Somebody else's row. Refuse — for update and delete, and for
            // upsert too, where "update it instead" would be the leak.
            if (existing && existing.organizationId !== orgId) {
              throw new Error("NOT_FOUND_IN_ORGANIZATION");
            }

            if (operation === "upsert") {
              // Nothing matched, or ours did. Either way anything created here
              // is born into this organization.
              const create = (a.create ?? {}) as Record<string, unknown>;
              return run({ ...a, create: { ...create, organizationId: orgId } });
            }

            if (!existing) throw new Error("NOT_FOUND_IN_ORGANIZATION");
            return run(a);
          }

          return query(args);
        },
      },
    },
  });
}

/** "SocialPost" -> "socialPost", the key Prisma exposes on the client. */
function toDelegate(model: string): keyof typeof prisma {
  return (model.charAt(0).toLowerCase() + model.slice(1)) as keyof typeof prisma;
}

export type ScopedDb = ReturnType<typeof dbForOrg>;
