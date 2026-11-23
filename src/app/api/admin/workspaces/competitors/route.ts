export const runtime = "edge";
/**
 * v4.86.0 — send a client's competitors into the client's OWN workspace.
 *
 * Platform admin only (admin of the primary Gershon workspace).
 *
 * GET  ?orgId=<workspace>  → that workspace's companies + competitor links (verification)
 *
 * POST {
 *   targetOrgId: string,          // the client's workspace
 *   sourceCompanyId: string,      // the client's company in the Gershon workspace
 *   targetCompanyId?: string,     // the client's company in its own workspace (auto-detected if omitted)
 *   dryRun?: boolean
 * }
 * Every competitor linked to the Gershon company is mirrored into the target
 * workspace as COMPETITION (re-used when a company of that name is already
 * there), linked to the target company's Competitor Watch, and its posts are
 * copied. The Gershon rows stay — they are what the Chrome extension collects.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { ClientType, UserRole } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { adminScopeFor } from "@/lib/admin-scope";
import { getCompetitorIds, setCompetitorIds } from "@/lib/competitors/store";
import { mirrorClientInto, syncMirrors } from "@/lib/workspaces/mirror";
import { findExistingByName, mergeCompetitorIds, pickTargetCompany } from "@/lib/workspaces/competitor-transfer-core";

const schema = z.object({
  targetOrgId: z.string().min(1),
  sourceCompanyId: z.string().min(1),
  targetCompanyId: z.string().optional(),
  dryRun: z.boolean().optional(),
});

async function platformAdmin() {
  const actor = await requireRole(UserRole.ADMIN);
  const scope = await adminScopeFor(actor);
  if (!scope.isPlatformAdmin || !scope.orgId) throw new Error("FORBIDDEN");
  return { actor, orgId: scope.orgId };
}

function authErr(e: unknown) {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Platform admins only" }, { status: 403 });
  return NextResponse.json({ success: false, error: m || "Failed" }, { status: 500 });
}

async function workspaceCompanies(orgId: string) {
  return prisma.client.findMany({
    where: { organizationId: orgId, archivedAt: null },
    select: { id: true, name: true, clientType: true, status: true },
    orderBy: { name: "asc" },
  });
}

async function mirrorMap(orgId: string) {
  const links = await prisma.orgSetting.findMany({ where: { organizationId: orgId, key: { startsWith: "mirror:" } } });
  return new Map(links.map((l) => [l.key.slice("mirror:".length), l.value]));
}

export async function GET(req: NextRequest) {
  try {
    await platformAdmin();
  } catch (e) {
    return authErr(e);
  }
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ success: false, error: "orgId required" }, { status: 400 });
  const companies = await workspaceCompanies(orgId);
  const links = await prisma.orgSetting.findMany({ where: { organizationId: orgId, key: { startsWith: "competitors:" } } });
  const name = new Map(companies.map((c) => [c.id, c.name]));
  const competitors = links.map((l) => {
    let ids: string[] = [];
    try {
      ids = JSON.parse(l.value);
    } catch {}
    const id = l.key.slice("competitors:".length);
    return { companyId: id, company: name.get(id) ?? null, competitors: ids.map((x) => name.get(x) ?? x) };
  });
  return NextResponse.json({ success: true, data: { companies, competitors } });
}

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await platformAdmin();
  } catch (e) {
    return authErr(e);
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  if (body.targetOrgId === ctx.orgId) {
    return NextResponse.json({ success: false, error: "Target must be a client workspace, not Gershon's" }, { status: 400 });
  }

  try {
    const org = await prisma.organization.findUnique({ where: { id: body.targetOrgId }, select: { id: true, name: true, slug: true } });
    if (!org) return NextResponse.json({ success: false, error: "Workspace not found" }, { status: 404 });

    const source = await prisma.client.findFirst({
      where: { id: body.sourceCompanyId, organizationId: ctx.orgId },
      select: { id: true, name: true },
    });
    if (!source) return NextResponse.json({ success: false, error: "Company not in the Gershon workspace" }, { status: 404 });

    const companies = await workspaceCompanies(org.id);
    const pick = pickTargetCompany({
      sourceId: source.id,
      sourceName: source.name,
      explicitId: body.targetCompanyId,
      mirrorSourceByTarget: await mirrorMap(org.id),
      companies,
    });
    if (!pick.company) {
      return NextResponse.json(
        { success: false, error: `Could not find ${source.name} in workspace ${org.name} (${pick.reason})`, data: { companies } },
        { status: 409 }
      );
    }
    const self = pick.company;

    const competitorIds = await getCompetitorIds(ctx.orgId, source.id);
    const competitors = await prisma.client.findMany({
      where: { id: { in: competitorIds }, organizationId: ctx.orgId },
      select: { id: true, name: true },
    });

    const plan = competitors.map((c) => {
      const existing = findExistingByName(c.name, companies);
      return { sourceId: c.id, name: c.name, reuse: existing && existing.id !== self.id ? existing.id : null };
    });

    if (body.dryRun) {
      return NextResponse.json({
        success: true,
        data: { workspace: org.name, company: self.name, match: pick.reason, competitors: plan, dryRun: true },
      });
    }

    const placed: string[] = [];
    for (const p of plan) {
      if (p.reuse) {
        placed.push(p.reuse);
        continue;
      }
      const m = await mirrorClientInto(org, { sourceClientId: p.sourceId, clientType: ClientType.COMPETITION });
      placed.push(m.targetId);
    }

    const before = await getCompetitorIds(org.id, self.id);
    const after = mergeCompetitorIds(before, placed, self.id);
    await setCompetitorIds(org.id, self.id, after);

    const sync = await syncMirrors({ orgId: org.id, cap: 200 });

    await prisma.auditLog.create({
      data: {
        organizationId: ctx.orgId,
        actorUserId: ctx.actor.id ?? null,
        actionType: "CLIENT_UPDATED",
        entityType: "Client",
        entityId: self.id,
        afterJson: JSON.stringify({ competitorsSentToWorkspace: org.id, from: source.id, placed: placed.length }),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        workspace: org.name,
        company: self.name,
        match: pick.reason,
        added: plan.map((p) => p.name),
        competitorCount: after.length,
        postsCopied: sync.postsCopied,
        errors: sync.errors,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
