export const runtime = "edge";
/**
 * /api/publishing/accounts — where each client's posts go, and who reviews them.
 * (v4.37.0)
 *
 * GET  → clients with { xHandle, linkedinUrl, reviewerName, reviewerEmail, reviewUrl, pending }
 * PUT  { clientId, xHandle?, linkedinUrl?, reviewerName?, reviewerEmail? }
 * POST { clientId, action: "rotate_link" } — new review link; the old one stops working.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { getTarget, reviewToken, reviewUrl, saveTarget } from "@/lib/publishing";

async function row(orgId: string, cl: { id: string; name: string; clientType: string }) {
  const [t, token, pending] = await Promise.all([
    getTarget(orgId, cl.id),
    reviewToken(orgId, cl.id),
    prisma.contentItem.count({ where: { organizationId: orgId, clientId: cl.id, status: { in: ["IN_REVIEW", "CHANGES_REQUESTED"] } } }),
  ]);
  return { ...cl, ...t, reviewUrl: reviewUrl(token), pending };
}

export async function GET() {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  try {
    const clients = await prisma.client.findMany({
      where: { organizationId: c.orgId, archivedAt: null, status: { not: "ARCHIVED" }, clientType: { in: ["CAMPAIGN", "INTERNAL", "CLIENT"] } },
      select: { id: true, name: true, clientType: true },
      orderBy: [{ clientType: "asc" }, { name: "asc" }],
    });
    const rows = [];
    for (const cl of clients) rows.push(await row(c.orgId, cl));
    return NextResponse.json({ success: true, data: { accounts: rows, canWrite: c.canWrite } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

async function clientOf(orgId: string, id: unknown) {
  if (typeof id !== "string") return null;
  return prisma.client.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true, clientType: true } });
}

export async function PUT(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, string | null | undefined>;
  const cl = await clientOf(c.orgId, b.clientId);
  if (!cl) return NextResponse.json({ success: false, error: "Unknown client." }, { status: 400 });
  await saveTarget(c.orgId, cl.id, {
    xHandle: b.xHandle, linkedinUrl: b.linkedinUrl, reviewerName: b.reviewerName, reviewerEmail: b.reviewerEmail,
  });
  return NextResponse.json({ success: true, data: await row(c.orgId, cl) });
}

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, string>;
  const cl = await clientOf(c.orgId, b.clientId);
  if (!cl) return NextResponse.json({ success: false, error: "Unknown client." }, { status: 400 });
  if (b.action !== "rotate_link") return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  await reviewToken(c.orgId, cl.id, true);
  return NextResponse.json({ success: true, data: await row(c.orgId, cl) });
}
