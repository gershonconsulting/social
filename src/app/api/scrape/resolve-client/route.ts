export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/scrape/resolve-client?url=<linkedin or x URL>
 *
 * Match a given LinkedIn / X / GBP URL back to a client + platform pair so
 * a one-click bookmarklet (running on the page itself) can POST scraped
 * posts to /api/scrape/import without the user needing to know clientIds.
 *
 * URL normalization is forgiving:
 *  - strips https://www., trailing slash, query string
 *  - matches by either externalAccountUrl prefix OR LinkedIn handle/slug
 *
 * Returns { clientId, clientName, platform } or 404 if no match.
 */
function normalize(u: string): string {
  return u.trim().toLowerCase()
    .replace(/^https?:\/\/(?:www\.|fr\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function detectPlatform(host: string): string | null {
  if (host.includes("linkedin.com")) return "LINKEDIN";
  if (host.includes("twitter.com") || host.includes("x.com")) return "TWITTER";
  if (host.includes("google.com/maps") || host.includes("g.co/kgs")) return "GOOGLE_BUSINESS";
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl.searchParams.get("url");
    if (!url) {
      return NextResponse.json({ success: false, error: "url required" }, { status: 400 });
    }
    const norm = normalize(url);
    const platform = detectPlatform(norm);
    if (!platform) {
      return NextResponse.json({ success: false, error: "Unsupported platform" }, { status: 400 });
    }

    // Strip trailing path segments (e.g. /posts, /recent-activity/all, /media)
    // so the bookmarklet matches the canonical profile URL.
    let stripped = norm;
    for (const tail of [
      "/posts/?feedview=all&viewasmember=true",
      "/posts",
      "/recent-activity/all",
      "/media",
      "/with_replies",
    ]) {
      if (stripped.endsWith(tail)) {
        stripped = stripped.slice(0, -tail.length);
        break;
      }
    }

    // Pull only the connections that could plausibly match. Looking up all
    // platform connections every request was burning Worker CPU and causing
    // intermittent 1101/1102s on Cloudflare. We pull the last URL segment
    // (handle / slug) and filter server-side via `contains`.
    const tail = stripped.split("/").filter(Boolean).pop() || "";
    const containsClause = tail
      ? { not: null, contains: tail, mode: "insensitive" as const }
      : { not: null };
    const all = await prisma.platformConnection.findMany({
      where: {
        platform: platform as "LINKEDIN" | "TWITTER" | "GOOGLE_BUSINESS",
        isEnabled: true,
        externalAccountUrl: containsClause,
        // Skip archived clients — earlier dedupe left some archived rows
        // whose connections were still isEnabled and were stealing matches.
        client: { is: { status: "ACTIVE" } },
      },
      select: {
        clientId: true,
        externalAccountUrl: true,
        client: { select: { name: true } },
      },
    });
    for (const c of all) {
      const stored = normalize(c.externalAccountUrl || "");
      if (!stored) continue;
      if (stored === stripped || stripped.startsWith(stored) || stored.startsWith(stripped)) {
        return NextResponse.json({
          success: true,
          data: {
            clientId: c.clientId,
            clientName: c.client.name,
            platform,
            matchedUrl: c.externalAccountUrl,
          },
        });
      }
    }
    return NextResponse.json(
      { success: false, error: `No client matches ${stripped} on ${platform}` },
      { status: 404 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resolve failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
