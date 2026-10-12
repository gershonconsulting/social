export const runtime = "edge";
/**
 * /api/publishing/content — the content board. (v4.37.0)
 *
 * GET  ?clientId=&status=A,B&from=ISO&to=ISO
 *      → { items (with deliveries + comment counts), clients, settings, live, limits }
 *      Sweeps first, so every status is current.
 * POST { clientId, title?, text, textX?, platforms, submit?, approve? }
 *      → creates an item. submit=true sends it to the client for review at once;
 *        approve=true approves it internally (no client review).
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import {
  ITEM_STATUSES, LINKEDIN_MAX, MAX_IMAGES, MEDIA_SELECT, addEvent, getPublisherState, getSettings, liveStatus, parsePlatforms, sweep, textProblems, xMax,
  PUBLISHING_CLIENT_WHERE,
} from "@/lib/publishing";
import { submitForReview } from "@/lib/publishing-review";

export async function GET(req: NextRequest) {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  try {
    await sweep(c.orgId).catch(() => null);
    const sp = new URL(req.url).searchParams;
    const where: Record<string, unknown> = { organizationId: c.orgId };
    const clientId = sp.get("clientId");
    if (clientId) where.clientId = clientId;
    const statuses = (sp.get("status") || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => (ITEM_STATUSES as readonly string[]).includes(s));
    if (statuses.length) where.status = { in: statuses };
    const from = sp.get("from");
    const to = sp.get("to");
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from && !Number.isNaN(Date.parse(from))) range.gte = new Date(from);
      if (to && !Number.isNaN(Date.parse(to))) range.lt = new Date(to);
      where.scheduledAt = range;
    }

    const [items, clients, settings, publisher] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        include: {
          deliveries: { orderBy: { platform: "asc" } },
          media: { select: MEDIA_SELECT, orderBy: { position: "asc" } },
          _count: { select: { comments: { where: { kind: "comment" } } } },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 500,
      }),
      prisma.client.findMany({
        where: { organizationId: c.orgId, archivedAt: null, status: { not: "ARCHIVED" }, ...PUBLISHING_CLIENT_WHERE },
        select: { id: true, name: true, clientType: true },
        orderBy: { name: "asc" },
      }),
      getSettings(c.orgId),
      getPublisherState(c.orgId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        items,
        clients,
        settings,
        publisher,
        live: liveStatus(publisher),
        limits: { x: xMax(settings), linkedin: LINKEDIN_MAX, images: MAX_IMAGES, requireImage: settings.requireImage },
        canWrite: c.canWrite,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  try {
    const b = (await req.json().catch(() => null)) as
      | { clientId?: string; title?: string; text?: string; textX?: string; platforms?: unknown; submit?: boolean; approve?: boolean }
      | null;
    const text = (b?.text || "").replace(/\r\n/g, "\n").trim();
    if (!text) return NextResponse.json({ success: false, error: "Write something first." }, { status: 400 });
    const platforms = parsePlatforms(b?.platforms ?? "LINKEDIN,TWITTER");
    if (!b?.clientId) return NextResponse.json({ success: false, error: "Pick a campaign or internal company first." }, { status: 400 });
    const cl = await prisma.client.findFirst({ where: { id: b.clientId, organizationId: c.orgId, ...PUBLISHING_CLIENT_WHERE }, select: { id: true } });
    if (!cl) return NextResponse.json({ success: false, error: "Publishing is only for campaign and internal companies." }, { status: 400 });
    const clientId: string = cl.id;
    const draft = { text, textX: (b?.textX || "").trim() || null, platforms: platforms.join(",") };
    const problems = textProblems(draft, await getSettings(c.orgId), 0);
    if (problems.length && (b?.submit || b?.approve)) {
      return NextResponse.json({ success: false, error: problems.join(" ") }, { status: 400 });
    }

    const item = await prisma.contentItem.create({
      data: {
        organizationId: c.orgId,
        clientId,
        title: (b?.title || "").trim() || null,
        ...draft,
        status: b?.approve ? "APPROVED" : "DRAFT",
        approvedAt: b?.approve ? new Date() : null,
        approvedBy: b?.approve ? c.name : null,
        approvedRole: b?.approve ? "team" : null,
        createdBy: c.name,
      },
    });
    await addEvent(c.orgId, item.id, 1, "created", "team", c.name);
    if (b?.approve) await addEvent(c.orgId, item.id, 1, "approved", "team", c.name, "Approved internally");
    if (b?.submit && !b?.approve) {
      const err = await submitForReview(c.orgId, item.id, c.name);
      if (err) return NextResponse.json({ success: true, data: item, warning: err });
    }
    return NextResponse.json({ success: true, data: item });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
