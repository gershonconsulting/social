export const runtime = "edge";
/**
 * Campaign posting objectives (posts per week) — Settings card.
 *
 * GET → { default, companies: [{ id, name, status, perWeek, custom }] } for the
 *       workspace's CAMPAIGN companies.
 * PUT → { default?: number, companies?: { [clientId]: number | null } }
 *       null (or the default value) removes a company's own objective.
 * Admin of the workspace only. Stored in OrgSetting `posting_objectives`.
 */
import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import rawDb from "@/lib/db-raw";
import { requireRole } from "@/lib/auth";
import { adminScopeFor } from "@/lib/admin-scope";
import { DEFAULT_PER_WEEK, objectivesFor, saveObjectives } from "@/lib/campaigns/objectives";

async function orgOf(): Promise<string | NextResponse> {
  try {
    const actor = await requireRole(UserRole.ADMIN);
    const scope = await adminScopeFor(actor);
    if (!scope.orgId) return NextResponse.json({ success: false, error: "No workspace" }, { status: 409 });
    return scope.orgId;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    return NextResponse.json({ success: false, error: "Admins only" }, { status: 403 });
  }
}

async function campaigns(orgId: string) {
  return rawDb.client.findMany({
    where: { organizationId: orgId, clientType: "CAMPAIGN", status: { not: "ARCHIVED" } },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
  });
}

async function payload(orgId: string) {
  const list = await campaigns(orgId);
  const { o } = await objectivesFor(orgId, list);
  return {
    default: o.default,
    companies: list.map((c) => ({ id: c.id, name: c.name, status: c.status, perWeek: o.companies[c.id] ?? o.default, custom: o.companies[c.id] != null })),
  };
}

export async function GET() {
  const org = await orgOf();
  if (org instanceof NextResponse) return org;
  try {
    return NextResponse.json({ success: true, data: await payload(org) });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const org = await orgOf();
  if (org instanceof NextResponse) return org;
  try {
    const body = (await req.json().catch(() => ({}))) as { default?: unknown; companies?: Record<string, unknown> };
    const list = await campaigns(org);
    const { o } = await objectivesFor(org, list);
    const valid = (n: unknown) => { const v = Number(n); return Number.isFinite(v) && v > 0 && v <= 50 ? Math.round(v * 10) / 10 : null; };
    if (body.default !== undefined) o.default = valid(body.default) ?? DEFAULT_PER_WEEK;
    const ids = new Set(list.map((c) => c.id));
    for (const [id, n] of Object.entries(body.companies || {})) {
      if (!ids.has(id)) continue;
      const v = n === null ? null : valid(n);
      if (v == null || v === o.default) delete o.companies[id];
      else o.companies[id] = v;
    }
    await saveObjectives(org, o);
    return NextResponse.json({ success: true, data: await payload(org) });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
