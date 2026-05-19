export const runtime = 'edge';
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, Platform } from "@prisma/client";

/**
 * GET /api/admin/coverage
 *
 * For each active client, returns per-platform coverage flags:
 *   hasLink   — a PlatformConnection row with an externalAccountUrl exists
 *   hasData   — at least one SocialPost row exists for (clientId, platform)
 *   upToDate  — at least one SocialPost row in the last 14 days
 *
 * Used by /admin/coverage to render the
 *   0/1/2/3 green-check grid (no link → no data → stale → fresh).
 *
 * Caching: short-TTL public cache so flipping back to the page is instant.
 */
const PLATFORMS: Platform[] = [Platform.LINKEDIN, Platform.TWITTER, Platform.GOOGLE_BUSINESS];

interface PerPlatform {
  hasLink: boolean;
  hasData: boolean;
  upToDate: boolean;
  postCount: number;
  latestPostAt: string | null;
  externalAccountUrl: string | null;
}

export async function GET() {
  try {
    const FRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - FRESH_WINDOW_MS);

    // Pull active clients + their connections, then aggregate posts in JS.
    const [clients, conns, postCounts, latestPosts, recentPostKeys] = await Promise.all([
      prisma.client.findMany({
        where: { status: ClientStatus.ACTIVE },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true, clientType: true, website: true },
      }),
      prisma.platformConnection.findMany({
        where: { isEnabled: true, platform: { in: PLATFORMS } },
        select: {
          clientId: true,
          platform: true,
          externalAccountUrl: true,
          externalAccountName: true,
        },
      }),
      // Total post counts per (clientId, platform). Counting via groupBy is
      // far cheaper than fetching every row.
      prisma.socialPost.groupBy({
        by: ["clientId", "platform"],
        _count: { _all: true },
      }),
      // Most recent post timestamp per (clientId, platform). groupBy with
      // _max is one round-trip.
      prisma.socialPost.groupBy({
        by: ["clientId", "platform"],
        _max: { publishedAtUtc: true },
      }),
      // Did this (clientId, platform) post anything inside the fresh window?
      prisma.socialPost.groupBy({
        by: ["clientId", "platform"],
        where: { publishedAtUtc: { gte: cutoff } },
        _count: { _all: true },
      }),
    ]);

    // Index lookups
    const connKey = (cid: string, p: Platform) => `${cid}:${p}`;
    const connByKey = new Map<string, { url: string | null; name: string | null }>();
    for (const c of conns) {
      connByKey.set(connKey(c.clientId, c.platform), {
        url: c.externalAccountUrl,
        name: c.externalAccountName,
      });
    }
    const countByKey = new Map<string, number>();
    for (const r of postCounts) countByKey.set(connKey(r.clientId, r.platform), r._count._all);
    const latestByKey = new Map<string, Date | null>();
    for (const r of latestPosts) latestByKey.set(connKey(r.clientId, r.platform), r._max.publishedAtUtc);
    const freshByKey = new Set<string>();
    for (const r of recentPostKeys) {
      if ((r._count._all ?? 0) > 0) freshByKey.add(connKey(r.clientId, r.platform));
    }

    const rows = clients.map((c) => {
      const platforms: Record<string, PerPlatform> = {};
      for (const p of PLATFORMS) {
        const k = connKey(c.id, p);
        const conn = connByKey.get(k);
        const postCount = countByKey.get(k) ?? 0;
        const latest = latestByKey.get(k) ?? null;
        const hasLink = !!(conn?.url);
        const hasData = postCount > 0;
        const upToDate = freshByKey.has(k);
        platforms[p] = {
          hasLink,
          hasData,
          upToDate,
          postCount,
          latestPostAt: latest ? latest.toISOString() : null,
          externalAccountUrl: conn?.url ?? null,
        };
      }
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        clientType: c.clientType,
        website: c.website,
        platforms,
      };
    });

    return NextResponse.json(
      { success: true, data: { clients: rows, freshWindowDays: 14 } },
      { headers: { "Cache-Control": "public, max-age=15, s-maxage=60" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "coverage query failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
