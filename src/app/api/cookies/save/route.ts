export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { resolveRequestOrg } from "@/lib/session-org";
import { getOrgCookies, saveOrgCookies, type SessionPlatform } from "@/lib/x-session";

/**
 * POST /api/cookies/save
 *
 * Receives a captured set of session cookies from the GershonAI Chrome
 * extension (or a signed-in dashboard tab) and stores them for THE CALLER'S
 * WORKSPACE, so server-side collection reads X / LinkedIn with that
 * workspace's own access.
 *
 * Body: { platform: 'LINKEDIN' | 'TWITTER', cookies: {name: value}, capturedAt?: ISO }
 *
 * v4.8.0: used to write the GLOBAL Setting row with no credential at all —
 * any caller could replace Gershon's X session. Now the workspace comes from
 * the session or the extension's workspace token (see lib/session-org.ts),
 * and the value is encrypted at rest (lib/x-session.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const org = await resolveRequestOrg(req);
    if (!org.ok) return NextResponse.json({ success: false, error: org.error }, { status: org.status });

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
    const required = platform === "LINKEDIN" ? "li_at" : "auth_token";
    if (!body.cookies[required]) {
      return NextResponse.json({ success: false, error: `Missing required cookie: ${required}` }, { status: 400 });
    }

    // Only string values, bounded — this is a credential store, not a dump.
    const cookies: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.cookies).slice(0, 60)) {
      if (typeof v === "string" && k.length <= 100) cookies[k] = v.slice(0, 4000);
    }

    const saved = await saveOrgCookies(org.orgId, platform as SessionPlatform, cookies, {
      capturedAt: body.capturedAt ?? null,
      source: org.via === "extension" ? "extension" : "manual",
    });

    return NextResponse.json({
      success: true,
      data: { platform, cookieCount: Object.keys(cookies).length, capturedAt: saved.capturedAt },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** GET — capture status for the caller's workspace. Never returns cookie values. */
export async function GET(req: NextRequest) {
  try {
    const org = await resolveRequestOrg(req);
    if (!org.ok) return NextResponse.json({ success: false, error: org.error }, { status: org.status });
    const status: Record<string, { capturedAt: string; cookieCount: number } | null> = { LINKEDIN: null, TWITTER: null };
    for (const p of ["LINKEDIN", "TWITTER"] as const) {
      const b = await getOrgCookies(org.orgId, p);
      const n = Object.keys(b.cookies).length;
      status[p] = n ? { capturedAt: b.capturedAt ?? "", cookieCount: n } : null;
    }
    return NextResponse.json({ success: true, data: status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
