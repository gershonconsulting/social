export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, Platform } from "@prisma/client";

/**
 * GET /api/admin/daily-collection-status?days=7
 *
 * Returns a matrix of (client × platform × day) booleans — true if we
 * ingested at least one post for that (client, platform) on that day.
 *
 * Used by:
 *   - The "best-effort cloud scrape" Claude routine, which only retries
 *     clients that are missing for TODAY.
 *   - The Logs page top section: today's row is the headline (green ✓ /
 *     red ✗ per client), with N prior days underneath for context.
 *
 * Output:
 *   { success: true, data: {
 *       days: ["2026-05-19", "2026-05-18", ...],
 *       platforms: ["LINKEDIN", "TWITTER"],
 *       clients: [{
 *         id, name, slug, clientType,
 *         // per-day per-platform got-data flag
 *         status: { "2026-05-19": { LINKEDIN: true, TWITTER: false }, ... },
 *         // v4.59.0 audit: false = no enabled connection for that platform,
 *         // so the status flag for it means "not configured", not "missing".
 *         configured: { LINKEDIN: true, TWITTER: false }
 *       }],
 *   } }
 */

const PLATFORMS: Platform[] = [Platform.LINKEDIN, Platform.TWITTER];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const daysRaw = parseInt(url.searchParams.get("days") || "7", 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 30 ? daysRaw : 7;

    // v4.59.0 audit: build the day range in America/New_York, not UTC — after
    // 8pm ET the UTC date had already rolled over and "today" was tomorrow.
    // en-CA formats as YYYY-MM-DD.
    const todayNY = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const base = new Date(`${todayNY}T12:00:00Z`);
    const dayStrs: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - i);
      dayStrs.push(d.toISOString().slice(0, 10));
    }
    const earliest = dayStrs[dayStrs.length - 1];

    const [clients, connections, posts] = await Promise.all([
      prisma.client.findMany({
        where: { status: ClientStatus.ACTIVE },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true, clientType: true },
      }),
      // v4.59.0 audit: which (client, platform) pairs have an enabled connection.
      prisma.platformConnection.findMany({
        where: { isEnabled: true, platform: { in: PLATFORMS } },
        select: { clientId: true, platform: true },
      }),
      prisma.socialPost.findMany({
        where: { publishedDateLocal: { gte: earliest } },
        select: { clientId: true, platform: true, publishedDateLocal: true },
      }),
    ]);

    // Index posts into a Set of "clientId:platform:date" keys
    const has = new Set<string>();
    for (const p of posts) {
      has.add(`${p.clientId}:${p.platform}:${p.publishedDateLocal}`);
    }

    const enabled = new Set(connections.map((pc) => `${pc.clientId}:${pc.platform}`));

    const rows = clients.map((c) => {
      const configured: Record<string, boolean> = {};
      for (const plat of PLATFORMS) configured[plat] = enabled.has(`${c.id}:${plat}`);
      const status: Record<string, Record<string, boolean>> = {};
      for (const day of dayStrs) {
        const perPlat: Record<string, boolean> = {};
        for (const plat of PLATFORMS) {
          perPlat[plat] = has.has(`${c.id}:${plat}:${day}`);
        }
        status[day] = perPlat;
      }
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        clientType: c.clientType,
        status,
        configured,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        days: dayStrs,
        platforms: PLATFORMS,
        clients: rows,
      },
      // v4.59.0 audit: per-workspace session data — never in a shared cache.
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
