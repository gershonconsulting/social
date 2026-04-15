export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { UserRole } from "@prisma/client";

// Extract all href values from HTML
function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const regex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    let url = match[1];
    // Decode HTML entities
    url = url.replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&#47;/g, "/");
    hrefs.push(url);
  }
  return hrefs;
}

// Platform detection from URLs
const PLATFORM_MATCHERS: { platform: string; test: (url: string) => boolean; clean: (url: string) => string }[] = [
  {
    platform: "LINKEDIN",
    test: (url) => /linkedin\.com\/(company|in|school)\/[a-zA-Z0-9_-]+/i.test(url),
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in|school)\/[a-zA-Z0-9_-]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "TWITTER",
    test: (url) => {
      if (!/(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/i.test(url)) return false;
      // Exclude share/intent/generic pages
      return !/\/(intent|share|sharer|login|signup|help|i\/|search|hashtag)\b/i.test(url);
    },
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "GOOGLE_BUSINESS",
    test: (url) =>
      /google\.com\/maps\/place\//i.test(url) ||
      /g\.page\//i.test(url) ||
      /business\.google\.com/i.test(url),
    clean: (url) => url.split("?")[0],
  },
  {
    platform: "FACEBOOK",
    test: (url) => {
      if (!/(?:facebook\.com|fb\.com)\/[a-zA-Z0-9._-]+/i.test(url)) return false;
      return !/\/(sharer|share|dialog|plugins|login|help)\b/i.test(url);
    },
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com)\/[a-zA-Z0-9._-]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "INSTAGRAM",
    test: (url) => {
      if (!/instagram\.com\/[a-zA-Z0-9._]+/i.test(url)) return false;
      return !/\/(explore|reels|stories|accounts|developer|legal)\b/i.test(url);
    },
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "YOUTUBE",
    test: (url) => /youtube\.com\/(c\/|channel\/|@)[a-zA-Z0-9_-]+/i.test(url),
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)[a-zA-Z0-9_-]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "TIKTOK",
    test: (url) => /tiktok\.com\/@[a-zA-Z0-9._-]+/i.test(url),
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?tiktok\.com\/@[a-zA-Z0-9._-]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "PINTEREST",
    test: (url) => {
      if (!/pinterest\.com\/[a-zA-Z0-9_-]+/i.test(url)) return false;
      return !/\/(pin\/|explore)\b/i.test(url);
    },
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?pinterest\.com\/[a-zA-Z0-9_-]+)\/?/i);
      return m ? m[1] : url;
    },
  },
  {
    platform: "THREADS",
    test: (url) => /threads\.net\/@[a-zA-Z0-9._]+/i.test(url),
    clean: (url) => {
      const m = url.match(/(https?:\/\/(?:www\.)?threads\.net\/@[a-zA-Z0-9._]+)\/?/i);
      return m ? m[1] : url;
    },
  },
];

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    let title = titleMatch[1].trim();
    title = title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    // Remove common suffixes
    title = title.replace(/\s*[\|–—-]\s*(home|official|website|site|welcome).*$/i, "").trim();
    // If still very long, take first part before separator
    if (title.length > 60) {
      const parts = title.split(/\s*[\|–—-]\s*/);
      if (parts.length > 1) title = parts[parts.length - 1].trim() || parts[0].trim();
    }
    return title;
  }
  const ogMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1].trim();
  return "";
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(UserRole.ADMIN);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ success: false, error: msg }, { status: msg === "UNAUTHORIZED" ? 401 : 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.website || typeof body.website !== "string") {
    return NextResponse.json({ success: false, error: "website URL is required" }, { status: 400 });
  }

  let url = body.website.trim();
  if (!url.startsWith("http")) url = "https://" + url;

  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GershonSocialBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Website returned ${res.status}` }, { status: 422 });
    }
    html = await res.text();
  } catch {
    return NextResponse.json({ success: false, error: "Could not fetch website. Check the URL." }, { status: 422 });
  }

  const name = extractTitle(html) || new URL(url).hostname.replace(/^www\./, "").split(".")[0];

  // Extract all hrefs and match against platform patterns
  const hrefs = extractHrefs(html);
  const discovered: { platform: string; url: string }[] = [];
  const seenPlatforms = new Set<string>();

  for (const href of hrefs) {
    if (!href.startsWith("http")) continue;
    for (const matcher of PLATFORM_MATCHERS) {
      if (seenPlatforms.has(matcher.platform)) continue;
      if (matcher.test(href)) {
        seenPlatforms.add(matcher.platform);
        discovered.push({ platform: matcher.platform, url: matcher.clean(href) });
        break;
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      name,
      slug: slugify(name),
      website: url,
      discovered,
    },
  });
}
