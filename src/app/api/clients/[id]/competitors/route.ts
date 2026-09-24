/**
 * Competitor Watch endpoint.
 *
 * GET    ?window=90  → the comparison (company vs each tracked competitor) +
 *                      the COMPETITION companies that could still be added.
 * POST   { competitorId }                         → track an existing company
 *        { name, linkedinUrl?, xUrl?, website? }  → create a COMPETITION company
 *                                                   (ACTIVE, so the extension
 *                                                   starts collecting it) and track it
 * DELETE ?competitorId=… → stop tracking (the company itself is kept).
 */

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType, ConnectionStatus, Platform } from "@prisma/client";
import { buildCompetitorWatch } from "@/lib/competitors/analyze";
import { getBrief, getCompetitorIds, requireOrgId, setCompetitorIds } from "@/lib/competitors/store";
import { getAISettings } from "@/lib/content/provider";

const ALLOWED_WINDOWS = [30, 90, 180, 365];

function parseWindow(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("window") ?? 90);
  return ALLOWED_WINDOWS.includes(raw) ? raw : 90;
}

function fail(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  const status = message === "NO_ORGANIZATION" || message === "UNAUTHORIZED" ? 401 : 500;
  return NextResponse.json({ success: false, error: message }, { status });
}

async function loadClient(id: string) {
  return prisma.client.findUnique({ where: { id }, select: { id: true, name: true, clientType: true } });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const windowDays = parseWindow(req);
    const client = await loadClient(id);
    if (!client) return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });

    const orgId = await requireOrgId();
    const ids = await getCompetitorIds(orgId, id);

    const competitorRows = ids.length
      ? await prisma.client.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            name: true,
            website: true,
            status: true,
            platformConnections: { select: { platform: true, externalAccountUrl: true } },
          },
        })
      : [];
    // Keep the saved order; silently drop ids whose company was deleted.
    const ordered = ids
      .map((cid) => competitorRows.find((r) => r.id === cid))
      .filter((r): r is (typeof competitorRows)[number] => !!r);

    const [watch, available, brief, ai] = await Promise.all([
      buildCompetitorWatch(client, ordered.map((r) => ({ id: r.id, name: r.name })), windowDays),
      prisma.client.findMany({
        where: { clientType: ClientType.COMPETITION, status: { not: ClientStatus.ARCHIVED }, id: { notIn: [id, ...ids] } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 200,
      }),
      getBrief(orgId, id, windowDays),
      getAISettings(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        client,
        windowDays,
        watch,
        competitors: ordered.map((r) => ({
          id: r.id,
          name: r.name,
          website: r.website,
          status: r.status,
          linkedin: r.platformConnections.find((p) => p.platform === Platform.LINKEDIN)?.externalAccountUrl ?? null,
          x: r.platformConnections.find((p) => p.platform === Platform.TWITTER)?.externalAccountUrl ?? null,
        })),
        available,
        brief,
        aiConfigured: !!ai.apiKey,
      },
    });
  } catch (err) {
    return fail(err, "Failed to load competitors");
  }
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "competitor"
  );
}

function cleanUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u.trim()) return null;
  const s = u.trim().startsWith("http") ? u.trim() : `https://${u.trim()}`;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await loadClient(id);
    if (!client) return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });

    const orgId = await requireOrgId();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let competitorId = typeof body.competitorId === "string" ? body.competitorId : null;

    if (competitorId) {
      const exists = await prisma.client.findUnique({ where: { id: competitorId }, select: { id: true } });
      if (!exists) return NextResponse.json({ success: false, error: "Competitor not found" }, { status: 404 });
    } else {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
      if (!name) return NextResponse.json({ success: false, error: "Name required" }, { status: 400 });
      const linkedinUrl = cleanUrl(body.linkedinUrl);
      const xUrl = cleanUrl(body.xUrl);
      const website = cleanUrl(body.website);

      // Re-use a company with the same name in this workspace instead of duplicating it.
      const same = await prisma.client.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (same) {
        competitorId = same.id;
      } else {
        let slug = slugify(name);
        for (let i = 2; await prisma.client.findFirst({ where: { slug }, select: { id: true } }).catch(() => null); i++) {
          slug = `${slugify(name)}-${i}`;
          if (i > 20) break;
        }
        const created = await prisma.client.create({
          data: {
            name,
            slug,
            status: ClientStatus.ACTIVE,
            clientType: ClientType.COMPETITION,
            website,
            notes: `Competitor of ${client.name} (added from Competitor Watch)`,
          },
        });
        competitorId = created.id;
      }

      // Add any missing connections. Competitors are tracked, not enforced.
      const conns = await prisma.platformConnection.findMany({
        where: { clientId: competitorId },
        select: { platform: true },
      });
      const have = new Set(conns.map((c) => c.platform));
      const toAdd: Array<[Platform, string]> = [];
      if (linkedinUrl && !have.has(Platform.LINKEDIN)) toAdd.push([Platform.LINKEDIN, linkedinUrl]);
      if (xUrl && !have.has(Platform.TWITTER)) toAdd.push([Platform.TWITTER, xUrl]);
      for (const [platform, url] of toAdd) {
        await prisma.platformConnection.create({
          data: {
            clientId: competitorId,
            platform,
            externalAccountUrl: url,
            connectionStatus: ConnectionStatus.PENDING,
            isMandatory: false,
            isEnabled: true,
          },
        });
      }
    }

    if (competitorId === id) {
      return NextResponse.json({ success: false, error: "A company cannot be its own competitor" }, { status: 400 });
    }

    const ids = await getCompetitorIds(orgId, id);
    if (!ids.includes(competitorId)) {
      if (ids.length >= 25) {
        return NextResponse.json({ success: false, error: "25 competitors maximum" }, { status: 400 });
      }
      await setCompetitorIds(orgId, id, [...ids, competitorId]);
    }
    return NextResponse.json({ success: true, data: { competitorId } }, { status: 201 });
  } catch (err) {
    return fail(err, "Failed to add competitor");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await loadClient(id);
    if (!client) return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
    const competitorId = req.nextUrl.searchParams.get("competitorId");
    if (!competitorId) return NextResponse.json({ success: false, error: "competitorId required" }, { status: 400 });
    const orgId = await requireOrgId();
    const ids = await getCompetitorIds(orgId, id);
    await setCompetitorIds(orgId, id, ids.filter((x) => x !== competitorId));
    return NextResponse.json({ success: true });
  } catch (err) {
    return fail(err, "Failed to remove competitor");
  }
}
