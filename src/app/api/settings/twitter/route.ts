export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { orgFromSession } from "@/lib/session-org";
import { saveOrgCookies } from "@/lib/x-session";

const schema = z.object({
  authToken: z.string().min(20).max(400),
  ct0: z.string().min(20).max(400),
});

/**
 * POST /api/settings/twitter   Body: { authToken, ct0 }
 *
 * Legacy entry point, kept for older UI. Since v4.8.0 it stores the X session
 * for the CALLER'S WORKSPACE (see /api/settings/x-account, lib/x-session.ts)
 * instead of stamping it on every Twitter connection in the database.
 */
export async function POST(req: NextRequest) {
  try {
    const orgId = await orgFromSession();
    if (!orgId) return NextResponse.json({ success: false, error: "Not signed in to a workspace" }, { status: 401 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Both auth_token and ct0 cookies are required (20+ chars each)." },
        { status: 400 },
      );
    }
    await saveOrgCookies(orgId, "TWITTER", { auth_token: parsed.data.authToken, ct0: parsed.data.ct0 }, { source: "manual" });
    return NextResponse.json({ success: true, message: "X session saved for your workspace." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save session";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
