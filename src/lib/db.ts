/**
 * The database client every route imports — tenant-scoped, automatically.
 *
 * WHY THIS EXISTS. Applying multi-tenancy by editing 229 call sites across 64
 * files would have meant transcribing every one of those files through the
 * GitHub API, and — much worse — it only takes one of them being missed for a
 * tenant to read another tenant's client book. So the scope is applied where
 * the client is handed out rather than where it is used. Route code does not
 * change at all: `import prisma from "@/lib/db"` already means "the client I
 * am allowed to use", and now that is true.
 *
 * HOW IT DECIDES. Every operation resolves the caller first (see
 * scoped-db.ts):
 *
 *   signed in, has a workspace  → the scoped client. Reads are filtered to that
 *                                 organization, writes are stamped with it, and
 *                                 writes aimed at another tenant's row are
 *                                 refused.
 *   nobody signed in            → the raw client, exactly as before. This is
 *                                 not a loophole, it is the system context: the
 *                                 cron routes, the Chrome extension endpoints
 *                                 and the sign-in callbacks all run with no
 *                                 session and no tenant to be scoped to. None
 *                                 of them serves a browser holding a login.
 *   signed in, NO workspace     → throws NO_ORGANIZATION.
 *
 * That last case is the one that matters, and it is why this file throws
 * instead of degrading. A user who is authenticated but has not been placed in
 * an organization is precisely the person who must not be handed an unfiltered
 * client; failing loudly is the only acceptable outcome.
 *
 * THE LAZY PROMISE. Resolving the caller is asynchronous, but Prisma's API is
 * synchronous — `prisma.client.findMany(...)` has to return something
 * immediately. So it returns a thenable that does the resolution when it is
 * awaited. Two consequences are handled here:
 *
 *   - $transaction([...]) is passed an array of these thenables. They carry the
 *     call they stand for, so $transaction claims them (synchronously, before
 *     they can start on their own) and re-issues them on the real client, which
 *     keeps the batch in one transaction.
 *   - a query nobody awaits — `void prisma.auditLog.create(...)` — would never
 *     run if it only fired on `.then`. So an unclaimed thenable starts itself
 *     at the end of the tick.
 *
 * $queryRaw and friends go straight to the raw client. Raw SQL bypasses the
 * extension entirely, so those queries carry their own organizationId
 * predicates or are deliberately deployment-wide.
 */
import type { PrismaClient } from "@prisma/client";
import raw from "@/lib/db-raw";
import { dbForOrg, resolveOrg } from "@/lib/scoped-db";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRec = Record<string, any>;

const LAZY = Symbol.for("gershon.scoped.lazyOp") as unknown as string;

/** The Prisma delegate methods we intercept. Anything else falls through. */
const OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** The client this caller is allowed to use. */
async function activeClient(): Promise<AnyRec> {
  const { signedIn, orgId } = await resolveOrg();
  if (!signedIn) return raw as unknown as AnyRec;
  if (!orgId) {
    throw new Error(
      "NO_ORGANIZATION: this account is not attached to a workspace, so there " +
        "is no tenant to scope its queries to.",
    );
  }
  return dbForOrg(orgId) as unknown as AnyRec;
}

type LazyMeta = {
  model: string;
  op: string;
  args: unknown;
  /** Take ownership before it self-starts. True if it had not started yet. */
  claim(): boolean;
};

function lazyOp(model: string, op: string, args: unknown) {
  let started: Promise<unknown> | null = null;
  let claimed = false;

  const start = () => (started ??= activeClient().then((c) => c[model][op](args)));

  // Fire-and-forget safety net: if by the end of this tick nobody has awaited
  // it and no $transaction has claimed it, run it anyway. Anything built and
  // awaited (or claimed) in the same tick — which is every real call site —
  // gets here with `claimed` or `started` already set and is left alone.
  queueMicrotask(() => {
    if (!claimed && !started) start().catch(() => undefined);
  });

  const meta: LazyMeta = {
    model,
    op,
    args,
    claim() {
      claimed = true;
      return started === null;
    },
  };

  return {
    [LAZY]: meta,
    then: (onOk?: any, onErr?: any) => {
      claimed = true;
      return start().then(onOk, onErr);
    },
    catch: (onErr?: any) => {
      claimed = true;
      return start().catch(onErr);
    },
    finally: (onDone?: any) => {
      claimed = true;
      return start().finally(onDone);
    },
  } as any;
}

function metaOf(value: unknown): LazyMeta | null {
  if (!value || typeof value !== "object") return null;
  return ((value as AnyRec)[LAZY] as LazyMeta | undefined) ?? null;
}

/**
 * Batched writes. The array elements are our thenables; claim them before they
 * self-start, then re-issue them on the real client so they run as one
 * transaction rather than as N independent statements.
 */
async function scopedTransaction(arg: unknown, options?: unknown) {
  const claimedMetas = Array.isArray(arg)
    ? arg.map((el) => {
        const meta = metaOf(el);
        meta?.claim();
        return meta;
      })
    : null;

  const client = await activeClient();

  if (Array.isArray(arg) && claimedMetas) {
    const ops = arg.map((el, i) => {
      const meta = claimedMetas[i];
      return meta ? client[meta.model][meta.op](meta.args) : el;
    });
    return client.$transaction(ops, options);
  }

  // Interactive form: Prisma hands the callback an extended (still scoped)
  // transaction client.
  return client.$transaction(arg, options);
}

const delegateCache = new Map<string, AnyRec>();

function delegateFor(model: string): AnyRec {
  const hit = delegateCache.get(model);
  if (hit) return hit;
  const proxy = new Proxy(
    {},
    {
      get(_t, op) {
        if (typeof op !== "string") return undefined;
        if (OPERATIONS.has(op)) {
          return (args?: unknown) => lazyOp(model, op, args);
        }
        // Anything else on a delegate (fields metadata, extension helpers)
        // comes off the raw client untouched.
        const value = (raw as unknown as AnyRec)[model]?.[op];
        return typeof value === "function"
          ? value.bind((raw as unknown as AnyRec)[model])
          : value;
      },
    },
  );
  delegateCache.set(model, proxy);
  return proxy;
}

const scopedClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (typeof prop !== "string") {
      return (raw as unknown as AnyRec)[prop as unknown as string];
    }
    if (prop === "$transaction") return scopedTransaction;
    if (prop.startsWith("$") || prop.startsWith("_")) {
      const value = (raw as unknown as AnyRec)[prop];
      return typeof value === "function" ? value.bind(raw) : value;
    }
    if (prop === "then") return undefined; // never look like a promise
    return delegateFor(prop);
  },
});

export default scopedClient;
export { scopedClient as prisma };
