export const runtime = "edge";
/**
 * Give a person their own workspace, seeded with mirrored companies.
 *
 * POST (platform admin only — the admin of the primary Gershon workspace)
 * {
 *   userId: string,                 // must currently be in the admin's workspace
 *   workspaceName: string,          // e.g. "VALOS"
 *   role?: "ADMIN"|"OPERATIONS"|"READ_ONLY"   // their role in the new workspace (default ADMIN)
 *   companies: [{ sourceClientId, clientType }],   // copied + mirrored
 *   competitorsOf?: sourceClientId  // set Competitor Watch for this company to every COMPETITION item
 * }
 *
 * Moves the user OUT of the Gershon workspace (they stop seeing its companies
 * on their very next request — see lib/fresh-user.ts), creates the workspace,
 * mirrors the companies with their LinkedIn/X connections, links competitors,
 * and copies existing posts so the new workspace is not empty on day one.
 * Nothing is removed from the Gershon workspace.
 *
 * GET → the workspaces this admin can see, for verification.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { ClientType, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { adminScopeFor } from "@/lib/admin-scope";
import { createOrganizationFor } from "@/lib/tenancy";
import { OWNER_EMAILS } from "@/lib/linkedin-auth";
import { mirrorClientInto, syncMirrors } from "@/lib/workspaces/mirror";
import { forgetUser } from "@/lib/fresh-user";

const schema = z.object({
  userId: z.string().min(1),
  workspaceName: z.string().min(1).max(120),
  role: z.nativeEnum(UserRole).optional(),
  companies: z
    .array(z.object({ sourceClientId: z.string().min(1), clientType: z.nativeEnum(ClientType) }))
    .min(1)
    .max(40),
  competitorsOf: z.string().optional(),
});

async function platformAdmin() {
  const actor = await requireRole(UserRole.ADMIN);
  const scope = await adminScopeFor(actor);
  if (!scope.isPlatformAdmin || !scope.orgId) throw new Error("FORBIDDEN");
  return { actor, scope };
}

function authErr(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Platform admins only" }, { status: 403 });
  return NextResponse.json({ success: false, error: m || "Failed" }, { status: 500 });
}

export async function GET() {
  try {
    await platformAdmin();
    const orgs = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        isPrimary: true,
        createdAt: true,
        users: { select: { name: true, email: true, role: true, isActive: true } },
        _count: { select: { clients: true, socialPosts: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ success: true, data: orgs });
  } catch (e) {
    return authErr(e);
  }
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await platformAdmin();
  } catch (e) {
    return authErr(e);
  }
  const { actor, scope } = ctx;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user || user.organizationId !== scope.orgId) {
      return NextResponse.json({ success: false, error: "User not found in your workspace" }, { status: 404 });
    }
    if (user.id === actor.id || OWNER_EMAILS.includes(user.email.toLowerCase())) {
      return NextResponse.json({ success: false, error: "The platform owner stays in the primary workspace" }, { status: 400 });
    }

    // Every source company must belong to the admin's own workspace.
    const ids = body.companies.map((c) => c.sourceClientId);
    const owned = await prisma.client.count({ where: { id: { in: ids }, organizationId: scope.orgId } });
    if (owned !== new Set(ids).size) {
      return NextResponse.json({ success: false, error: "Some companies are not in your workspace" }, { status: 400 });
    }

    const org = await createOrganizationFor(body.workspaceName);

    // Move the person first: from here on they can no longer read Gershon data.
    await prisma.user.update({
      where: { id: user.id },
      data: { organizationId: org.id, role: body.role ?? UserRole.ADMIN, isActive: true, pendingApproval: false },
    });
    forgetUser(user.id);

    const mirrored: Array<{ sourceId: string; targetId: string; name: string; clientType: ClientType }> = [];
    for (const item of body.companies) {
      const m = await mirrorClientInto(org, item);
      mirrored.push({ ...m, clientType: item.clientType });
    }

    if (body.competitorsOf) {
      const self = mirrored.find((m) => m.sourceId === body.competitorsOf);
      if (self) {
        const competitorIds = mirrored.filter((m) => m.clientType === ClientType.COMPETITION).map((m) => m.targetId);
        await prisma.orgSetting.upsert({
          where: { organizationId_key: { organizationId: org.id, key: `competitors:${self.targetId}` } },
          update: { value: JSON.stringify(competitorIds) },
          create: { organizationId: org.id, key: `competitors:${self.targetId}`, value: JSON.stringify(competitorIds) },
        });
      }
    }

    const sync = await syncMirrors({ orgId: org.id });

    await prisma.auditLog.create({
      data: {
        organizationId: scope.orgId,
        actorUserId: actor.id ?? null,
        actionType: "USER_UPDATED",
        entityType: "User",
        entityId: user.id,
        afterJson: JSON.stringify({ movedToWorkspace: org.id, workspaceName: org.name, companies: mirrored.length }),
      },
    });

    return NextResponse.json({
      success: true,
      data: { workspace: org, user: { id: user.id, email: user.email }, companies: mirrored, sync },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
