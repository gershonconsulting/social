/**
 * Multi-tenancy: one Organization per customer, and nobody sees anybody else's
 * data.
 *
 * Two jobs live here.
 *
 * 1. THE BACKFILL. Everything in this database predates tenancy, so every row
 *    carries organizationId = NULL. `ensureTenancy()` creates the primary
 *    organization (Gershon Consulting) once and adopts every orphan row into
 *    it. It is idempotent, cheap after the first run, and never throws into a
 *    request — a failed backfill must not take the dashboard down.
 *
 *    It deliberately runs from application code rather than a migration step,
 *    because deploys here are `prisma db push` + Cloudflare Pages with no seed
 *    stage, and a backfill that needs somebody to remember to run it is a
 *    backfill that doesn't run.
 *
 * 2. RESOLVING THE CALLER'S ORG, which is what every scoped query needs.
 *
 * Enforcement of the scope itself is NOT here and is NOT per-query by hand:
 * 229 call sites means one forgotten `where` is a cross-tenant leak. That
 * filter is applied centrally — see scoped-db.ts, and db.ts which hands it out.
 *
 * Which is exactly why this file imports the RAW client. Its job is to find
 * rows belonging to no organization at all; a scoped client, by construction,
 * cannot see those, and its updateMany would rewrite `organizationId: null`
 * into `organizationId: <the current org>` and quietly match nothing.
 */
import prisma from "@/lib/db-raw";

const BACKFILL_KEY = "tenancy_backfill";
const BACKFILL_VERSION = "1";

/** Google My Business row cleanup — see removeGoogleMyBusiness below. */
const GMB_KEY = "gmb_removed";
const GMB_VERSION = "1";

/** Set once per isolate so the marker rows aren't re-read on every request. */
let backfilledInThisIsolate = false;
let gmbRemovedInThisIsolate = false;

export type Org = { id: string; name: string; slug: string };

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

/** A slug nobody else holds. */
export async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const clash = await prisma.organization.findUnique({ where: { slug: candidate } });
    if (!clash) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/**
 * Create the primary organization and adopt every pre-tenancy row into it.
 * Safe to call on every request: after the first success it is one indexed
 * read, and after the first call in this isolate it is free.
 */
export async function ensureTenancy(): Promise<void> {
  if (backfilledInThisIsolate) return;

  try {
    const marker = await prisma.setting.findUnique({ where: { key: BACKFILL_KEY } });
    if (marker) {
      const parsed = JSON.parse(marker.value) as { version?: string };
      if (parsed.version === BACKFILL_VERSION) {
        backfilledInThisIsolate = true;
        return;
      }
    }

    const primary =
      (await prisma.organization.findFirst({ where: { isPrimary: true } })) ??
      (await prisma.organization.create({
        data: {
          name: "Gershon Consulting",
          slug: await uniqueSlug("gershon-consulting"),
          isPrimary: true,
        },
      }));

    const orgId = primary.id;
    const orphan = { organizationId: null };
    const adopt = { organizationId: orgId };

    // Order doesn't matter; each is an indexed updateMany that matches nothing
    // on a second run.
    await prisma.user.updateMany({ where: orphan, data: adopt });
    await prisma.client.updateMany({ where: orphan, data: adopt });
    await prisma.platformConnection.updateMany({ where: orphan, data: adopt });
    await prisma.postingSchedule.updateMany({ where: orphan, data: adopt });
    await prisma.socialPost.updateMany({ where: orphan, data: adopt });
    await prisma.dailyCompliance.updateMany({ where: orphan, data: adopt });
    await prisma.followerSnapshot.updateMany({ where: orphan, data: adopt });
    await prisma.contentAnalysis.updateMany({ where: orphan, data: adopt });
    await prisma.postPrompt.updateMany({ where: orphan, data: adopt });
    await prisma.syncJob.updateMany({ where: orphan, data: adopt });
    await prisma.auditLog.updateMany({ where: orphan, data: adopt });

    // Credentials move to the tenant that owns them. The registration mode is
    // platform-level and deliberately stays in the global table.
    const globals = await prisma.setting.findMany();
    for (const row of globals) {
      if (row.key === "registration" || row.key === BACKFILL_KEY) continue;
      await prisma.orgSetting.upsert({
        where: { organizationId_key: { organizationId: orgId, key: row.key } },
        create: { organizationId: orgId, key: row.key, value: row.value },
        update: {},
      });
    }

    await prisma.setting.upsert({
      where: { key: BACKFILL_KEY },
      create: {
        key: BACKFILL_KEY,
        value: JSON.stringify({ version: BACKFILL_VERSION, orgId, at: new Date().toISOString() }),
      },
      update: {
        value: JSON.stringify({ version: BACKFILL_VERSION, orgId, at: new Date().toISOString() }),
      },
    });

    backfilledInThisIsolate = true;
  } catch {
    // Never surface a backfill failure into a page render. The next request
    // tries again; until it succeeds nothing is scoped, which is the state the
    // app was already in.
  }
}

/**
 * Delete every Google My Business row. "Nothing there to collect" — the
 * adapter is gone, so these rows can no longer be synced or read; they are
 * just dead weight pinning an enum value in place.
 *
 * WHY THIS HAS TO RUN BEFORE THE ENUM VALUE CAN GO. `prisma db push` refuses
 * to drop a value from an enum while any row still references it, and this
 * deploy pipeline is `db push` with no migration or seed stage. So the rows go
 * in THIS deploy, from application code, and GOOGLE_BUSINESS leaves the
 * Platform enum in the NEXT one. Two deploys, in that order, no shortcuts.
 *
 * Children before parents: DailyCompliance and FollowerSnapshot and SocialPost
 * and PostingSchedule all hang off a PlatformConnection, and the connection is
 * what carries the platform, so each child is matched through it.
 *
 * Idempotent, marker-guarded, and silent on failure like the backfill above —
 * a cleanup that fails must not take a page render down with it.
 */
export async function removeGoogleMyBusiness(): Promise<void> {
  if (gmbRemovedInThisIsolate) return;

  try {
    const marker = await prisma.setting.findUnique({ where: { key: GMB_KEY } });
    if (marker) {
      const parsed = JSON.parse(marker.value) as { version?: string };
      if (parsed.version === GMB_VERSION) {
        gmbRemovedInThisIsolate = true;
        return;
      }
    }

    // Raw string rather than Platform.GOOGLE_BUSINESS on purpose: the enum
    // value is removed in the next deploy, and this code has to keep compiling
    // across that change — it is the thing that makes the change possible.
    const platform = "GOOGLE_BUSINESS" as never;

    const connections = await prisma.platformConnection.findMany({
      where: { platform },
      select: { id: true },
    });
    const connectionIds = connections.map((c) => c.id);

    if (connectionIds.length > 0) {
      const byConnection = { platformConnectionId: { in: connectionIds } };
      await prisma.dailyCompliance.deleteMany({ where: byConnection });
      await prisma.followerSnapshot.deleteMany({ where: byConnection });
      await prisma.socialPost.deleteMany({ where: byConnection });
      await prisma.postingSchedule.deleteMany({ where: byConnection });
      await prisma.platformConnection.deleteMany({ where: { id: { in: connectionIds } } });
    }

    await prisma.setting.upsert({
      where: { key: GMB_KEY },
      create: {
        key: GMB_KEY,
        value: JSON.stringify({
          version: GMB_VERSION,
          connectionsDeleted: connectionIds.length,
          at: new Date().toISOString(),
        }),
      },
      update: {
        value: JSON.stringify({
          version: GMB_VERSION,
          connectionsDeleted: connectionIds.length,
          at: new Date().toISOString(),
        }),
      },
    });

    gmbRemovedInThisIsolate = true;
  } catch {
    // Same contract as the backfill: never fail a request over housekeeping.
  }
}

/** The original Gershon workspace, creating it if this is the very first call. */
export async function getPrimaryOrganization(): Promise<Org | null> {
  await ensureTenancy();
  const org = await prisma.organization.findFirst({ where: { isPrimary: true } });
  return org ? { id: org.id, name: org.name, slug: org.slug } : null;
}

/** The workspace a given user belongs to. */
export async function getOrganizationForUser(userId: string): Promise<Org | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organization: { select: { id: true, name: true, slug: true } } },
  });
  return user?.organization ?? null;
}

/**
 * Create a workspace for somebody signing up, named after them.
 * The caller becomes its admin — you are the administrator of your own
 * workspace, which is a different thing from being an admin of someone else's.
 */
export async function createOrganizationFor(name: string): Promise<Org> {
  const org = await prisma.organization.create({
    data: { name: name.slice(0, 120), slug: await uniqueSlug(name) },
  });
  return { id: org.id, name: org.name, slug: org.slug };
}
