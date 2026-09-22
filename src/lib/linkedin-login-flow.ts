/**
 * The "Sign in with LinkedIn" resolution step, shared by both callback routes.
 *
 * Kept out of the route files because the LinkedIn app only has ONE registered
 * redirect URL, so /api/auth/linkedin/callback has to be able to finish a
 * sign-in as well as a client connection. See linkedin-auth.ts.
 *
 * The important behaviour here is the CLAIM. Production is seeded with an ADMIN
 * row that has no linkedinSub. If a first LinkedIn sign-in simply created a new
 * user, the operator would land in a second account and the existing account's
 * history (AuditLog.actorUserId, SyncJob.triggeredById) would be orphaned.
 * Instead, an allow-listed first sign-in ADOPTS that existing admin row — same
 * user id, nothing stranded.
 *
 * (Client / Post / PlatformConnection are not user-scoped, so the collected
 * social data itself was never at risk — only the per-user history.)
 */
import prisma from "@/lib/db";
import { UserRole } from "@prisma/client";
import { exchangeCode, fetchProfile, isAllowedAdminEmail } from "@/lib/linkedin-auth";

export type ResolvedUser = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
  image: string | null;
};

export type LoginOutcome =
  | { ok: true; user: ResolvedUser }
  | { ok: false; error: string };

export async function completeLinkedInLogin(
  code: string,
  redirectUri: string,
): Promise<LoginOutcome> {
  const token = await exchangeCode(code, redirectUri);
  const profile = await fetchProfile(token);

  const email = (profile.email || "").toLowerCase().trim();
  if (!email) {
    return {
      ok: false,
      error: "LinkedIn did not share an email address. Grant email permission and retry.",
    };
  }

  // 1) Already linked, or invited under this email.
  let user =
    (await prisma.user.findUnique({ where: { linkedinSub: profile.sub } })) ??
    (await prisma.user.findUnique({ where: { email } }));

  if (user && !user.isActive) {
    return { ok: false, error: "Your access has been disabled. Contact the account admin." };
  }

  if (user) {
    // Keep the linkage and profile fresh on every sign-in.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        linkedinSub: profile.sub,
        name: user.name || profile.name || email,
        image: profile.picture ?? user.image,
      },
    });
    return { ok: true, user: toResolved(updated) };
  }

  // 2) Nobody matched. Only an allow-listed address may become an admin.
  //
  // The address is named in the message on purpose. Without it this rejection is
  // undiagnosable: the email LinkedIn returns from OIDC is often NOT the address
  // you assume the account uses, and the fix (invite it, or add it to the
  // allow-list) depends entirely on knowing which address came back. Only the
  // person who just attempted the sign-in sees it, so it leaks nothing.
  if (!isAllowedAdminEmail(email)) {
    return {
      ok: false,
      error: `${email} isn't invited yet. Ask the admin to add that exact address under Admin → Users — it is the email on the LinkedIn account, which may differ from the one you expect.`,
    };
  }

  // 3) CLAIM the existing unclaimed admin rather than creating a second one.
  const unclaimed = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN, linkedinSub: null, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (unclaimed) {
    const before = { id: unclaimed.id, email: unclaimed.email, name: unclaimed.name };
    const claimed = await prisma.user.update({
      where: { id: unclaimed.id },
      data: {
        email,
        linkedinSub: profile.sub,
        name: profile.name || unclaimed.name,
        image: profile.picture ?? unclaimed.image,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: claimed.id,
        actionType: "USER_UPDATED",
        entityType: "User",
        entityId: claimed.id,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify({
          email: claimed.email,
          name: claimed.name,
          via: "linkedin-claim",
        }),
      },
    });
    return { ok: true, user: toResolved(claimed) };
  }

  // 4) No admin row to adopt — provision a fresh one.
  const created = await prisma.user.create({
    data: {
      name: profile.name || email,
      email,
      linkedinSub: profile.sub,
      image: profile.picture ?? null,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorUserId: created.id,
      actionType: "USER_CREATED",
      entityType: "User",
      entityId: created.id,
      afterJson: JSON.stringify({ email, role: "ADMIN", via: "linkedin-provision" }),
    },
  });
  return { ok: true, user: toResolved(created) };
}

function toResolved(u: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  image: string | null;
}): ResolvedUser {
  return { id: u.id, name: u.name, email: u.email, role: u.role, image: u.image };
}
