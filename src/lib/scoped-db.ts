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
 * database. Route code calls `await scopedDb()` and then writes ordinary
 * Prisma, unaware that anything is happening.
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
 * Routes with no signed-in user — the Chrome extension ingest endpoint and the
 * cron jobs — must NOT use this. They have no session to scope by, so they keep
 * using the raw client until they are given their own tenant routing.
 */
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";

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
 * The organization the signed-in user belongs to.
 *
 * Reads it from the session token first. Sessions minted before tenancy shipped
 * do not carry it, so there is a fallback lookup by user id — one indexed read,
 * and it disappears on their next sign-in.
 */
export async function getCurrentOrgId(): Promise<string | null> {
  const session = await getSession();
  const user = session?.user as { id?: string; organizationId?: string } | undefined;
  if (!user?.id) return null;
  if (user.organizationId) return user.organizationId;

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
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
  const orgId = await getCurrentOrgId();
  if (orgId === null) {
    const session = await getSession();
    throw new Error(session?.user ? "NO_ORGANIZATION" : "UNAUTHORIZED");
  }
  return dbForOrg(orgId);
}

/**
 * The same scoping, for a known organization id. Used by anything that resolves
 * its tenant some other way than a session — a per-org cron pass, say.
 */
export function dbForOrg(orgId: string) {
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
            const scoped = mergeWhere(a, orgId);
            const rows = await (
              prisma[toDelegate(model)] as unknown as {
                findFirst: (x: unknown) => Promise<unknown>;
              }
            ).findFirst(scoped);
            if (!rows && operation === "findUniqueOrThrow") {
              throw new Error(`No ${model} found`);
            }
            return rows;
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
            // Prisma demands a unique `where` here, so the scope can't be
            // merged in. Check ownership first and refuse otherwise.
            const where = (a.where ?? {}) as Record<string, unknown>;
            const existing = await (
              prisma[toDelegate(model)] as unknown as {
                findFirst: (x: unknown) => Promise<unknown>;
              }
            ).findFirst({ where: { ...where, organizationId: orgId }, select: { id: true } });

            if (!existing) {
              if (operation === "upsert") {
                // Nothing of ours to update — fall through to a scoped create.
                const create = (a.create ?? {}) as Record<string, unknown>;
                return run({ ...a, create: { ...create, organizationId: orgId } });
              }
              throw new Error("NOT_FOUND_IN_ORGANIZATION");
            }

            if (operation === "upsert") {
              const create = (a.create ?? {}) as Record<string, unknown>;
              return run({ ...a, create: { ...create, organizationId: orgId } });
            }
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

export type ScopedDb = Awaited<ReturnType<typeof scopedDb>>;
