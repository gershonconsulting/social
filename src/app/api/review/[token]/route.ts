export const runtime = "edge";
/**
 * /api/review/:token — the client's review portal (v4.37.0). No account:
 * the private link IS the access, scoped to one client of one workspace.
 * Rotating the link in Publishing → Accounts revokes it.
 *
 * GET  → { client, items: posts waiting for review + recent history, with threads }
 * POST { contentId, action: "comment" | "request_changes" | "approve", name?, body? }
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { resolveReviewToken } from "@/lib/publishing";
import { clientAction, type ClientAction } from "@/lib/publishing-review";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveReviewToken(token);
  if (!r) return NextResponse.json({ success: false, error: "This review link is not valid any more." }, { status: 404 });
  const [client, org, items] = await Promise.all([
    prisma.client.findFirst({ where: { id: r.clientId }, select: { name: true, logoUrl: true } }),
    prisma.organization.findUnique({ where: { id: r.orgId }, select: { name: true } }),
    prisma.contentItem.findMany({
      where: {
        organizationId: r.orgId,
        clientId: r.clientId,
        OR: [
          { status: { in: ["IN_REVIEW", "CHANGES_REQUESTED"] } },
          { status: { in: ["APPROVED", "SCHEDULED", "PUBLISHED", "PARTIAL"] }, updatedAt: { gt: new Date(Date.now() - 60 * 86400000) } },
        ],
      },
      select: {
        id: true, title: true, text: true, textX: true, platforms: true, status: true, scheduledAt: true, version: true,
        approvedAt: true, approvedBy: true, updatedAt: true,
        comments: {
          where: { kind: { in: ["comment", "submitted", "changes_requested", "approved", "edited", "published"] } },
          select: { id: true, authorName: true, authorRole: true, kind: true, body: true, version: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        },
        deliveries: { select: { platform: true, status: true, postUrl: true, postedAt: true } },
        media: { select: { id: true, key: true, position: true, width: true, height: true }, orderBy: { position: "asc" } },
      },
      orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
      take: 100,
    }),
  ]);
  return NextResponse.json({ success: true, data: { client: client?.name || "", logoUrl: client?.logoUrl || null, agency: org?.name || "", items } });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await resolveReviewToken(token);
  if (!r) return NextResponse.json({ success: false, error: "This review link is not valid any more." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { contentId?: string; action?: string; name?: string; body?: string } | null;
  const action = b?.action as ClientAction;
  if (!["comment", "request_changes", "approve", "approve_all"].includes(action) || (action !== "approve_all" && !b?.contentId)) {
    return NextResponse.json({ success: false, error: "Bad request" }, { status: 400 });
  }
  const err = await clientAction(r.orgId, r.clientId, b?.contentId || "", action, b?.name ?? null, b?.body ?? null);
  if (err) return NextResponse.json({ success: false, error: err }, { status: 400 });
  return NextResponse.json({ success: true });
}
