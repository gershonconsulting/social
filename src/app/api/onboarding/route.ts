export const runtime = "edge";
/**
 * Getting started — what this workspace still needs before it does anything.
 *
 * A new tenant lands in a workspace that is genuinely empty: no companies, no
 * LinkedIn or X links, no extension pointed at it, no posts. The dashboard in
 * that state is a page of zeroes, which tells somebody nothing about what to do
 * next. This endpoint answers that, and it answers it from REAL DATA rather
 * than from a stored "step 3 of 5" counter.
 *
 * That distinction matters more than it sounds. A stored step number goes wrong
 * the moment anything happens outside the wizard — somebody adds a company from
 * the Companies page, or deletes the one they added, or sets the extension up on
 * a second machine. Deriving each step from the thing it is actually asking for
 * means the checklist cannot lie, and somebody who did half the setup last week
 * sees exactly the half that is left.
 *
 * Scoped like everything else: the counts come from the caller's own workspace
 * via @/lib/db, so this is each tenant's own progress and nobody else's.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/db";
import rawPrisma from "@/lib/db-raw";
import { requireAuth } from "@/lib/auth";
import { getCurrentOrgId } from "@/lib/scoped-db";
import { getOrCreateExtensionToken } from "@/lib/extension-auth";

const DISMISS_KEY = "onboarding_dismissed";
/** Written by extension-auth the first time a tokened request arrives. */
const EXTENSION_SEEN_KEY = "extension_token_enforced";

export type OnboardingStep =
  | "name-workspace"
  | "add-your-company"
  | "add-companies-to-watch"
  | "install-extension"
  | "first-collection"
  | "done";

function authErr(e: unknown): NextResponse | null {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "NO_ORGANIZATION") {
    return NextResponse.json(
      { success: false, error: "Your account isn't attached to a workspace yet." },
      { status: 409 },
    );
  }
  return null;
}

export async function GET(_req: NextRequest) {
  try {
    await requireAuth();
    const orgId = await getCurrentOrgId();
    if (!orgId) throw new Error("NO_ORGANIZATION");

    const org = await rawPrisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, isPrimary: true },
    });

    // Everything below is scoped to this workspace by @/lib/db.
    const [companyCount, ownCompany, linkedinLinks, xLinks, postCount, dismissed, extensionSeen] =
      await Promise.all([
        prisma.client.count({ where: { status: { not: "ARCHIVED" } } }),
        prisma.client.findFirst({
          where: { clientType: "INTERNAL", status: { not: "ARCHIVED" } },
          select: { id: true, name: true },
        }),
        prisma.platformConnection.count({
          where: { platform: "LINKEDIN", externalAccountUrl: { not: null } },
        }),
        prisma.platformConnection.count({
          where: { platform: "TWITTER", externalAccountUrl: { not: null } },
        }),
        prisma.socialPost.count(),
        rawPrisma.orgSetting.findUnique({
          where: { organizationId_key: { organizationId: orgId, key: DISMISS_KEY } },
          select: { id: true },
        }),
        rawPrisma.orgSetting.findUnique({
          where: { organizationId_key: { organizationId: orgId, key: EXTENSION_SEEN_KEY } },
          select: { updatedAt: true },
        }),
      ]);

    // Minting on read is deliberate: the extension step is useless without a
    // token to show, and there is no reason to make somebody press a button to
    // bring one into existence.
    const token = await getOrCreateExtensionToken(orgId);

    // A workspace still called after the person who signed up hasn't been
    // named yet. The primary workspace was named by the backfill and is exempt.
    const named = !!org && (org.isPrimary || org.name.trim().length > 0);

    const steps = {
      nameWorkspace: named,
      addYourCompany: !!ownCompany,
      addCompaniesToWatch: companyCount > 1,
      installExtension: !!extensionSeen,
      firstCollection: postCount > 0,
    };

    const next: OnboardingStep = !steps.nameWorkspace
      ? "name-workspace"
      : !steps.addYourCompany
        ? "add-your-company"
        : !steps.addCompaniesToWatch
          ? "add-companies-to-watch"
          : !steps.installExtension
            ? "install-extension"
            : !steps.firstCollection
              ? "first-collection"
              : "done";

    return NextResponse.json({
      success: true,
      data: {
        workspace: org,
        steps,
        next,
        complete: next === "done",
        dismissed: !!dismissed,
        counts: { companies: companyCount, linkedinLinks, xLinks, posts: postCount },
        ownCompany,
        extensionToken: token,
        extensionLastSeen: extensionSeen?.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}

const postSchema = z.union([
  z.object({ action: z.literal("rename"), name: z.string().min(1).max(120) }),
  z.object({ action: z.literal("dismiss") }),
  z.object({ action: z.literal("resume") }),
]);

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const orgId = await getCurrentOrgId();
    if (!orgId) throw new Error("NO_ORGANIZATION");

    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    }

    if (parsed.data.action === "rename") {
      // The workspace row is not a tenant-scoped model, so this is the raw
      // client with the id pinned to the caller's own organization.
      await rawPrisma.organization.update({
        where: { id: orgId },
        data: { name: parsed.data.name.trim().slice(0, 120) },
      });
      return NextResponse.json({ success: true, data: { name: parsed.data.name.trim() } });
    }

    if (parsed.data.action === "dismiss") {
      await rawPrisma.orgSetting.upsert({
        where: { organizationId_key: { organizationId: orgId, key: DISMISS_KEY } },
        create: { organizationId: orgId, key: DISMISS_KEY, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
      return NextResponse.json({ success: true, data: { dismissed: true } });
    }

    await rawPrisma.orgSetting
      .delete({ where: { organizationId_key: { organizationId: orgId, key: DISMISS_KEY } } })
      .catch(() => undefined);
    return NextResponse.json({ success: true, data: { dismissed: false } });
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
