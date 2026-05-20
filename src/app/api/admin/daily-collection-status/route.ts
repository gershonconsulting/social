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
 *       platforms: ["LINKEDIN", "TWITTER", "GOOGLE_BUSINESS"],
 *       clients: [{
 *         id, name, slug, clientType,
 *         // per-day per-platform got-data flag
 *         status: { "2026-05-19": { LINKEDIN: true, TWITTER: false, GOOGLE_BUSINESS: false }, ... }
 *       }],
 *   } }
 */

const PLATFORMS: Platform[] = [Platform.LINKEDIN, Platform.TWITTER, Platform.GOOGLE_BUSINESS];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const daysRaw = parseInt(url.searchParams.get("days") || "7", 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 30 ? daysRaw : 7;

    // Build the day range — today + (days-1) prior days, as YYYY-MM-DD UTC strings.
    const today = new Date();
    const dayStrs: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      dayStrs.push(d.toISOString().slice(0, 10));
    }
    const earliest = dayStrs[dayStrs.length - 1];

    const [clients, posts] = await Promise.all([
      prisma.client.findMany({
        where: { status: ClientStatus.ACTIVE },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true, clientType: true },
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

    const rows = clients.map((c) => {
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
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        days: dayStrs,
        platforms: PLATFORMS,
        clients: rows,
      },
    }, { headers: { "Cache-Control": "public, max-age=15, s-maxage=60" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
