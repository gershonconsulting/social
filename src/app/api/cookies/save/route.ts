export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * POST /api/cookies/save
 *
 * Receives a captured set of session cookies from the Watchman Chrome
 * extension and stores them in the Setting table so the server can
 * authenticate scraping calls (LinkedIn Voyager API, X GraphQL, etc.).
 *
 * Body:
 *   {
 *     platform: 'LINKEDIN' | 'TWITTER',
 *     cookies: { [name: string]: value },   // li_at, JSESSIONID, auth_token, ct0, ...
 *     capturedAt: string (ISO)
 *   }
 *
 * Stored under Setting.key = "cookies:LINKEDIN" / "cookies:TWITTER".
 * Value is a JSON string of { cookies, capturedAt }.
 *
 * NOTE: stored as plain JSON in DB. This is a single-user platform per
 * the existing memory; if multi-tenant later, encrypt at rest.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { platform?: string; cookies?: Record<string, string>; capturedAt?: string }
      | null;
    if (!body?.platform || !body?.cookies || typeof body.cookies !== "object") {
      return NextResponse.json({ success: false, error: "platform + cookies required" }, { status: 400 });
    }
    const platform = body.platform.toUpperCase();
    if (platform !== "LINKEDIN" && platform !== "TWITTER") {
      return NextResponse.json({ success: false, error: "platform must be LINKEDIN or TWITTER" }, { status: 400 });
    }
    // Validate the required auth cookie is present
    const required = platform === "LINKEDIN" ? "li_at" : "auth_token";
    if (!body.cookies[required]) {
      return NextResponse.json({
        success: false,
        error: `Missing required cookie: ${required}`,
      }, { status: 400 });
    }

    const key = `cookies:${platform}`;
    const value = JSON.stringify({
      cookies: body.cookies,
      capturedAt: body.capturedAt ?? new Date().toISOString(),
    });

    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    return NextResponse.json({
      success: true,
      data: {
        platform,
        cookieCount: Object.keys(body.cookies).length,
        capturedAt: body.capturedAt ?? new Date().toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * GET /api/cookies/save  (helper for debugging — returns capture status,
 * never the actual cookie values).
 */
export async function GET() {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: ["cookies:LINKEDIN", "cookies:TWITTER"] } },
    });
    const status: Record<string, { capturedAt: string; cookieCount: number } | null> = {
      LINKEDIN: null,
      TWITTER: null,
    };
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.value) as { cookies?: Record<string, string>; capturedAt?: string };
        const plat = r.key.split(":")[1];
        status[plat] = {
          capturedAt: parsed.capturedAt ?? "",
          cookieCount: Object.keys(parsed.cookies ?? {}).length,
        };
      } catch {}
    }
    return NextResponse.json({ success: true, data: status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
