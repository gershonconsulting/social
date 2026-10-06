/**
 * The "Sign in with LinkedIn" resolution step, shared by both callback routes.
 *
 * Kept out of the route files because the LinkedIn app only has ONE registered
 * redirect URL, so /api/auth/linkedin/callback has to be able to finish a
 * sign-in as well as a client connection. See linkedin-auth.ts.
 *
 * Two behaviours matter here.
 *
 * THE CLAIM. Production was seeded with an ADMIN row that had no linkedinSub.
 * If a first LinkedIn sign-in had simply created a new user, the operator would
 * have landed in a second account and the original's history
 * (AuditLog.actorUserId, SyncJob.triggeredById) would have been orphaned. So an
 * allow-listed first sign-in ADOPTS that row — same user id, nothing stranded.
 * Only allow-listed addresses can do this; it is how you become an admin, so it
 * is deliberately not open to the world.
 *
 * SELF-REGISTRATION (v3.9.0). Everyone else may now sign up too, rather than
 * being turned away with "isn't invited yet". Whether the account is usable
 * immediately depends on the registration mode — see src/lib/registration.ts.
 *
 * Because the door is open, we keep everything LinkedIn tells us about the
 * person plus the request-side provenance Cloudflare attaches, so the Users
 * screen can answer "who is this and where did they come from".
 *
 * A NEW WORKSPACE PER SIGNUP (v4.3.0). Signing up no longer drops somebody
 * into Gershon Consulting's data. It creates an Organization of their own and
 * makes them the admin of THAT — which is a different thing from being an
 * admin of somebody else's workspace, and is safe precisely because every
 * query they can make is confined to their own organization (see db.ts).
 *
 * When registration is set to "wait for my approval", the workspace is NOT
 * created here. A pending account cannot sign in, so it has no use for one,
 * and rejecting somebody should not leave an empty organization behind. The
 * workspace is created at the moment of approval instead — see
 * /api/users/[id].
 *
 * NO PRISMA HERE (v4.26.1). Every query goes over Neon's HTTP driver
 * (sql-http.ts). The first Prisma query in a cold Cloudflare isolate boots the
 * 2 MB query-engine WASM, which blows the Worker CPU budget, and the sign-in
 * callback answered Error 1102 "Worker exceeded resource limits" instead of
 * landing the user on /dashboard. This file must stay Prisma-free — including
 * value imports from "@prisma/client" (types only).
 */
import type { UserRole } from "@prisma/client";
import { query, newId } from "@/lib/sql-http";
import { exchangeCode, fetchProfile, isAllowedAdminEmail } from "@/lib/linkedin-auth";
import type { LinkedInProfile } from "@/lib/linkedin-auth";

export type ResolvedUser = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  image: string | null;
  organizationId: string | null;
};

/** Request-side provenance. Cloudflare populates these headers at the edge. */
export type RequestContext = {
  ip?: string | null;
  country?: string | null;
  userAgent?: string | null;
};

export type LoginOutcome =
  | { ok: true; user: ResolvedUser; created?: boolean; pending?: boolean }
  | { ok: false; error: string };

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  image: string | null;
  organizationId: string | null;
  isActive: boolean;
  pendingApproval: boolean;
  approvedAt: string | Date | null;
  lastLoginIp: string | null;
  linkedinSub: string | null;
};

type Org = { id: string; name: string; slug: string };

export function readRequestContext(req: Request): RequestContext {
  const h = req.headers;
  return {
    ip: h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    country: h.get("cf-ipcountry") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) || null,
  };
}

function profileFields(profile: LinkedInProfile & Record<string, unknown>) {
  return {
    givenName: (profile.given_name as string | undefined) ?? null,
    familyName: (profile.family_name as string | undefined) ?? null,
    locale:
      typeof profile.locale === "string"
        ? profile.locale
        : // LinkedIn sometimes returns locale as { country, language }.
          profile.locale && typeof profile.locale === "object"
          ? [
              (profile.locale as { language?: string }).language,
              (profile.locale as { country?: string }).country,
            ]
              .filter(Boolean)
              .join("-") || null
          : null,
    emailVerified: profile.email_verified === true || profile.email_verified === "true",
    profileJson: safeJson(profile),
  };
}

function safeJson(v: unknown): string | null {
  try {
    return JSON.stringify(v).slice(0, 8000);
  } catch {
    return null;
  }
}

/* ---------------------------- SQL helpers ---------------------------- */

const USER_COLS = `id, name, email, role::text AS role, image, "organizationId", "isActive",
  "pendingApproval", "approvedAt", "lastLoginIp", "linkedinSub"`;

async function findUserBy(column: "linkedinSub" | "email", value: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    `SELECT ${USER_COLS} FROM users WHERE "${column}" = $1 LIMIT 1`,
    [value],
  );
  return rows[0] ?? null;
}

/** UPDATE users SET … (+ loginCount + 1) WHERE id = $id RETURNING the user. */
async function updateUser(id: string, data: Record<string, unknown>, bumpLogin = true): Promise<UserRow> {
  const keys = Object.keys(data);
  const params: unknown[] = [];
  const sets = keys.map((k) => {
    params.push(data[k]);
    const p = `$${params.length}`;
    return k === "role" ? `"role" = ${p}::"UserRole"` : `"${k}" = ${p}`;
  });
  params.push(new Date().toISOString());
  sets.push(`"updatedAt" = $${params.length}`);
  if (bumpLogin) sets.push(`"loginCount" = "loginCount" + 1`);
  params.push(id);
  const rows = await query<UserRow>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${USER_COLS}`,
    params,
  );
  if (!rows[0]) throw new Error("User disappeared during sign-in");
  return rows[0];
}

async function insertUser(data: Record<string, unknown>): Promise<UserRow> {
  const now = new Date().toISOString();
  const full: Record<string, unknown> = { id: newId(), createdAt: now, updatedAt: now, ...data };
  const keys = Object.keys(full);
  const params = keys.map((k) => full[k]);
  const values = keys.map((k, i) => (k === "role" ? `$${i + 1}::"UserRole"` : `$${i + 1}`));
  const rows = await query<UserRow>(
    `INSERT INTO users (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${values.join(", ")}) RETURNING ${USER_COLS}`,
    params,
  );
  return rows[0];
}

async function getPrimaryOrganization(): Promise<Org | null> {
  const rows = await query<Org>(
    `SELECT id, name, slug FROM organizations WHERE "isPrimary" = true ORDER BY "createdAt" ASC LIMIT 1`,
  );
  return rows[0] ?? null;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

async function createOrganizationFor(name: string): Promise<Org> {
  const root = slugify(name);
  let slug = `${root}-${Date.now().toString(36)}`;
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const clash = await query(`SELECT 1 FROM organizations WHERE slug = $1 LIMIT 1`, [candidate]);
    if (clash.length === 0) {
      slug = candidate;
      break;
    }
  }
  const now = new Date().toISOString();
  const rows = await query<Org>(
    `INSERT INTO organizations (id, name, slug, "isPrimary", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, false, $4, $4) RETURNING id, name, slug`,
    [newId(), name.slice(0, 120), slug, now],
  );
  return rows[0];
}

/**
 * Same rule as registration.ts.
 *
 * v4.32.0 — Olivier 2026-10-05: "No restrictions. Anyone can become new users
 * until further notice." The default is now "open", and a one-shot switch
 * (marker setting `registration_opened_v4_32`) flips an explicitly stored
 * "approval" to "open" exactly once. After that the Admin > Users toggle is
 * authoritative again, so "further notice" is one click there.
 * A DB error still means "approval" — never fail open on a broken read.
 */
async function getRegistrationMode(): Promise<"approval" | "open"> {
  try {
    await openRegistrationOnce();
    const rows = await query<{ value: string }>(`SELECT value FROM settings WHERE key = 'registration' LIMIT 1`);
    if (!rows[0]) return "open";
    const parsed = JSON.parse(rows[0].value) as { mode?: string };
    return parsed.mode === "approval" ? "approval" : "open";
  } catch {
    return "approval";
  }
}

const OPEN_MARKER = "registration_opened_v4_32";

async function openRegistrationOnce(): Promise<void> {
  const marker = await query<{ key: string }>(`SELECT key FROM settings WHERE key = $1 LIMIT 1`, [OPEN_MARKER]);
  if (marker[0]) return;
  const now = new Date().toISOString();
  await query(
    `INSERT INTO settings (id, key, value, "createdAt", "updatedAt") VALUES ($1, 'registration', $2, $3, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = EXCLUDED."updatedAt"`,
    [newId(), JSON.stringify({ mode: "open" }), now],
  );
  await query(
    `INSERT INTO settings (id, key, value, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (key) DO NOTHING`,
    [newId(), OPEN_MARKER, JSON.stringify({ at: now }), now],
  );
}

/* ------------------------------ the flow ------------------------------ */

export async function completeLinkedInLogin(
  code: string,
  redirectUri: string,
  ctx: RequestContext = {},
): Promise<LoginOutcome> {
  const token = await exchangeCode(code, redirectUri);
  const profile = (await fetchProfile(token)) as LinkedInProfile & Record<string, unknown>;

  const email = (profile.email || "").toLowerCase().trim();
  if (!email) {
    return {
      ok: false,
      error: "LinkedIn did not share an email address. Grant email permission and retry.",
    };
  }

  const fields = profileFields(profile);
  const now = new Date().toISOString();

  // 1) Already linked, or already invited under this email.
  const user = (await findUserBy("linkedinSub", profile.sub)) ?? (await findUserBy("email", email));

  if (user) {
    // An allow-listed operator (e.g. olivier@attia.com) belongs to the
    // ORIGINAL workspace. If an earlier sign-in parked them as a pending
    // self-signup, or in a fresh empty workspace of their own, bring them home
    // as ADMIN of the primary workspace instead of refusing or stranding them.
    if (isAllowedAdminEmail(email)) {
      const primary = await getPrimaryOrganization();
      const misplaced =
        !!primary &&
        (user.pendingApproval || !user.isActive || user.organizationId !== primary.id || user.role !== "ADMIN");
      if (primary && misplaced) {
        const before = { organizationId: user.organizationId, role: user.role, pendingApproval: user.pendingApproval };
        const moved = await updateUser(user.id, {
          organizationId: primary.id,
          role: "ADMIN",
          isActive: true,
          pendingApproval: false,
          approvedAt: user.approvedAt ? new Date(user.approvedAt).toISOString() : now,
          linkedinSub: profile.sub,
          name: user.name || profile.name || email,
          image: profile.picture ?? user.image,
          ...fields,
          lastLoginAt: now,
          lastLoginIp: ctx.ip ?? user.lastLoginIp,
        });
        await audit(moved.id, "USER_UPDATED", moved.id, before, {
          organizationId: primary.id,
          role: "ADMIN",
          via: "owner-rehome",
        }, primary.id);
        return { ok: true, user: toResolved(moved) };
      }
    }

    // Registration is open: an account left pending from the approval era is
    // let in on this sign-in — own workspace, ADMIN of it, exactly what the
    // Admin > Users "Approve" button would have done.
    if (user.pendingApproval && (await getRegistrationMode()) === "open") {
      const org = user.organizationId ? null : await createOrganizationFor(user.name || profile.name || email);
      const before = { pendingApproval: true, isActive: user.isActive, organizationId: user.organizationId };
      const approved = await updateUser(user.id, {
        pendingApproval: false,
        isActive: true,
        approvedAt: now,
        ...(org ? { organizationId: org.id, role: "ADMIN" } : {}),
        linkedinSub: profile.sub,
        name: user.name || profile.name || email,
        image: profile.picture ?? user.image,
        ...fields,
        lastLoginAt: now,
        lastLoginIp: ctx.ip ?? user.lastLoginIp,
      });
      await audit(approved.id, "USER_UPDATED", approved.id, before, {
        pendingApproval: false,
        workspace: org?.name ?? null,
        via: "open-registration-auto-approve",
      }, approved.organizationId);
      return { ok: true, user: toResolved(approved) };
    }

    if (user.pendingApproval) {
      return {
        ok: false,
        error:
          "Your account is waiting for an admin to approve it. You'll be able to sign in once it's approved.",
      };
    }
    if (!user.isActive) {
      return { ok: false, error: "Your access has been disabled. Contact the account admin." };
    }

    const updated = await updateUser(user.id, {
      linkedinSub: profile.sub,
      name: user.name || profile.name || email,
      image: profile.picture ?? user.image,
      ...fields,
      lastLoginAt: now,
      lastLoginIp: ctx.ip ?? user.lastLoginIp,
    });
    return { ok: true, user: toResolved(updated) };
  }

  // 2) Nobody matched. An allow-listed address CLAIMS the unclaimed admin row.
  if (isAllowedAdminEmail(email)) {
    const unclaimedRows = await query<UserRow>(
      `SELECT ${USER_COLS} FROM users
        WHERE role = 'ADMIN' AND "linkedinSub" IS NULL AND "isActive" = true
        ORDER BY "createdAt" ASC LIMIT 1`,
    );
    const unclaimed = unclaimedRows[0] ?? null;
    const primary = await getPrimaryOrganization();

    if (unclaimed) {
      const before = { id: unclaimed.id, email: unclaimed.email, name: unclaimed.name };
      const claimed = await updateUser(unclaimed.id, {
        email,
        linkedinSub: profile.sub,
        name: profile.name || unclaimed.name,
        image: profile.picture ?? unclaimed.image,
        ...fields,
        signupSource: "linkedin-claim",
        signupIp: ctx.ip ?? null,
        signupCountry: ctx.country ?? null,
        signupUserAgent: ctx.userAgent ?? null,
        approvedAt: now,
        lastLoginAt: now,
        lastLoginIp: ctx.ip ?? null,
        ...(unclaimed.organizationId ? {} : { organizationId: primary?.id ?? null }),
      });
      await audit(claimed.id, "USER_UPDATED", claimed.id, before, {
        email: claimed.email,
        name: claimed.name,
        via: "linkedin-claim",
      }, claimed.organizationId);
      return { ok: true, user: toResolved(claimed) };
    }

    const admin = await insertUser({
      name: profile.name || email,
      email,
      linkedinSub: profile.sub,
      image: profile.picture ?? null,
      role: "ADMIN",
      isActive: true,
      pendingApproval: false,
      organizationId: primary?.id ?? null,
      ...fields,
      signupSource: "linkedin-claim",
      signupIp: ctx.ip ?? null,
      signupCountry: ctx.country ?? null,
      signupUserAgent: ctx.userAgent ?? null,
      approvedAt: now,
      lastLoginAt: now,
      lastLoginIp: ctx.ip ?? null,
      loginCount: 1,
    });
    await audit(admin.id, "USER_CREATED", admin.id, null, {
      email,
      role: "ADMIN",
      via: "linkedin-provision",
    }, admin.organizationId);
    return { ok: true, user: toResolved(admin), created: true };
  }

  // 3) Self-registration. This person gets a workspace of their own — empty,
  //    and theirs — rather than a seat in somebody else's.
  const mode = await getRegistrationMode();
  const pending = mode === "approval";

  // A pending account cannot sign in, and a rejection should not leave an
  // orphan organization behind. Approval creates it.
  const org = pending ? null : await createOrganizationFor(profile.name || email);

  const created = await insertUser({
    name: profile.name || email,
    email,
    linkedinSub: profile.sub,
    image: profile.picture ?? null,
    role: pending ? "READ_ONLY" : "ADMIN",
    organizationId: org?.id ?? null,
    isActive: !pending,
    pendingApproval: pending,
    approvedAt: pending ? null : now,
    ...fields,
    signupSource: "linkedin-self",
    signupIp: ctx.ip ?? null,
    signupCountry: ctx.country ?? null,
    signupUserAgent: ctx.userAgent ?? null,
    lastLoginAt: now,
    lastLoginIp: ctx.ip ?? null,
    loginCount: 1,
  });

  await audit(created.id, "USER_CREATED", created.id, null, {
    email,
    name: created.name,
    role: created.role,
    via: "linkedin-self-registration",
    pendingApproval: pending,
    workspace: org?.name ?? null,
    country: ctx.country ?? null,
  }, org?.id ?? null);

  if (pending) {
    return {
      ok: false,
      error:
        "Thanks — your account has been created and is waiting for an admin to approve it. You'll be able to sign in once it's approved.",
    };
  }

  return { ok: true, user: toResolved(created), created: true };
}

async function audit(
  actorUserId: string | null,
  actionType: "USER_CREATED" | "USER_UPDATED",
  entityId: string,
  before: unknown,
  after: unknown,
  organizationId: string | null = null,
) {
  try {
    await query(
      `INSERT INTO audit_logs (id, "actorUserId", "actionType", "entityType", "entityId",
         "beforeJson", "afterJson", "organizationId", "createdAt")
       VALUES ($1, $2, $3::"AuditAction", 'User', $4, $5, $6, $7, $8)`,
      [
        newId(),
        actorUserId,
        actionType,
        entityId,
        before === null ? null : safeJson(before),
        safeJson(after),
        organizationId,
        new Date().toISOString(),
      ],
    );
  } catch {
    // An audit write must never be the reason a sign-in fails.
  }
}

function toResolved(u: UserRow): ResolvedUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    image: u.image,
    organizationId: u.organizationId,
  };
}
