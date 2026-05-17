export const runtime = 'edge';
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

/**
 * GET /api/extension/clients
 *
 * Returns the list of ACTIVE clients with their LinkedIn / X handles + the
 * matching PlatformConnection IDs. The GershonAI Chrome extension calls this
 * after capturing cookies, then scrapes each platform inside the user's
 * browser (real residential IP + real session) instead of from the
 * Cloudflare Worker — which gets shadow-banned by LinkedIn/X anti-bot.
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       clients: [
 *         { id, name, slug,
 *           linkedin: { connectionId, url, vanity } | null,
 *           twitter:  { connectionId, url, handle } | null
 *         },
 *         ...
 *       ]
 *     }
 *   }
 */
export async function GET() {
  try {
    const clients = await prisma.client.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      include: {
        platformConnections: {
          where: {
            isEnabled: true,
            platform: { in: [Platform.LINKEDIN, Platform.TWITTER] },
            externalAccountUrl: { not: null },
          },
          select: { id: true, platform: true, externalAccountUrl: true },
        },
      },
    });

    const out: Array<{
      id: string;
      name: string;
      slug: string;
      linkedin: { connectionId: string; url: string; vanity: string } | null;
      twitter: { connectionId: string; url: string; handle: string } | null;
    }> = [];

    for (const c of clients) {
      const li = c.platformConnections.find((p) => p.platform === Platform.LINKEDIN);
      const tw = c.platformConnections.find((p) => p.platform === Platform.TWITTER);
      let linkedin: { connectionId: string; url: string; vanity: string } | null = null;
      let twitter: { connectionId: string; url: string; handle: string } | null = null;
      if (li?.externalAccountUrl) {
        const m = li.externalAccountUrl.match(/linkedin\.com\/(?:company|in|school)\/([a-zA-Z0-9\-_.]+)/i);
        if (m) linkedin = { connectionId: li.id, url: li.externalAccountUrl, vanity: m[1] };
      }
      if (tw?.externalAccountUrl) {
        const m = tw.externalAccountUrl.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,20})/i);
        if (m) twitter = { connectionId: tw.id, url: tw.externalAccountUrl, handle: m[1] };
      }
      if (!linkedin && !twitter) continue;
      out.push({ id: c.id, name: c.name, slug: c.slug, linkedin, twitter });
    }

    return NextResponse.json({ success: true, data: { clients: out, totalClients: out.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
