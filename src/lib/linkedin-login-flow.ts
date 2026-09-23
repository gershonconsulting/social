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
 * This file talks to the RAW client on purpose. It runs before anybody is
 * signed in, so there is no tenant to scope to, and its job is partly to
 * decide which tenant the caller belongs to in the first place.
 */
import prisma from "@/lib/db-raw";
import { UserRole } from "@prisma/client";
import { exchangeCode, fetchProfile, isAllowedAdminEmail } from "@/lib/linkedin-auth";
import { getRegistrationMode } from "@/lib/registration";
import { createOrganizationFor, getPrimaryOrganization } from "@/lib/tenancy";
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
  const now = new Date();

  // 1) Already linked, or already invited under this email.
  const user =
    (await prisma.user.findUnique({ where: { linkedinSub: profile.sub } })) ??
    (await prisma.user.findUnique({ where: { email } }));

  if (user) {
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

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        linkedinSub: profile.sub,
        name: user.name || profile.name || email,
        image: profile.picture ?? user.image,
        ...fields,
        lastLoginAt: now,
        lastLoginIp: ctx.ip ?? user.lastLoginIp,
        loginCount: { increment: 1 },
      },
    });
    return { ok: true, user: toResolved(updated) };
  }

  // 2) Nobody matched. An allow-listed address CLAIMS the unclaimed admin row.
  //    This is how you become an admin of the ORIGINAL workspace, which is why
  //    it is limited to the allow-list and not open to the world.
  if (isAllowedAdminEmail(email)) {
    const unclaimed = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN, linkedinSub: null, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    // The operator belongs to the original workspace, whether they are
    // adopting its seeded admin row or being provisioned fresh.
    const primary = await getPrimaryOrganization();

    if (unclaimed) {
      const before = { id: unclaimed.id, email: unclaimed.email, name: unclaimed.name };
      const claimed = await prisma.user.update({
        where: { id: unclaimed.id },
        data: {
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
          loginCount: { increment: 1 },
          ...(unclaimed.organizationId ? {} : { organizationId: primary?.id ?? null }),
        },
      });
      await audit(claimed.id, "USER_UPDATED", claimed.id, before, {
        email: claimed.email,
        name: claimed.name,
        via: "linkedin-claim",
      });
      return { ok: true, user: toResolved(claimed) };
    }

    const admin = await prisma.user.create({
      data: {
        name: profile.name || email,
        email,
        linkedinSub: profile.sub,
        image: profile.picture ?? null,
        role: UserRole.ADMIN,
        isActive: true,
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
      },
    });
    await audit(admin.id, "USER_CREATED", admin.id, null, {
      email,
      role: "ADMIN",
      via: "linkedin-provision",
    });
    return { ok: true, user: toResolved(admin), created: true };
  }

  // 3) Self-registration. This person gets a workspace of their own — empty,
  //    and theirs — rather than a seat in somebody else's.
  const mode = await getRegistrationMode();
  const pending = mode === "approval";

  // Nothing to create for an account that cannot sign in yet, and a rejection
  // should not leave an orphan organization behind. Approval creates it.
  const org = pending ? null : await createOrganizationFor(profile.name || email);

  const created = await prisma.user.create({
    data: {
      name: profile.name || email,
      email,
      linkedinSub: profile.sub,
      image: profile.picture ?? null,
      // Admin OF THEIR OWN WORKSPACE. Every query they can make is confined to
      // it, so this grants authority over their data and nobody else's.
      role: pending ? UserRole.READ_ONLY : UserRole.ADMIN,
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
    },
  });

  await audit(created.id, "USER_CREATED", created.id, null, {
    email,
    name: created.name,
    role: created.role,
    via: "linkedin-self-registration",
    pendingApproval: pending,
    workspace: org?.name ?? null,
    country: ctx.country ?? null,
  });

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
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        actionType,
        entityType: "User",
        entityId,
        beforeJson: before === null ? null : safeJson(before),
        afterJson: safeJson(after),
      },
    });
  } catch {
    // An audit write must never be the reason a sign-in fails.
  }
}

function toResolved(u: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  image: string | null;
  organizationId: string | null;
}): ResolvedUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    image: u.image,
    organizationId: u.organizationId,
  };
}
