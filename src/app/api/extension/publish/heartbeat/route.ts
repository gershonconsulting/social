export const runtime = "edge";
/**
 * /api/extension/publish/heartbeat — the publishing browser checking in.
 * (v4.37.0, extension 0.15.0)
 *
 * POST (extension token)
 *   { x: { signedIn, as? }, linkedin: { signedIn, as? }, version?, error? }
 *   → { enabled, voice: { x, linkedin } }
 * Every 5 minutes and at once on any sign-in / sign-out. Drives the "Live"
 * strip on the Publishing pages and Settings.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolvePublishCaller } from "@/lib/publish-caller";
import prisma from "@/lib/db-raw";
import { getPublisherState, getSettings, normalizeHandle, savePublisherState, sweep, type NetSession } from "@/lib/publishing";

type In = { signedIn?: boolean; as?: string | null } | undefined;

function merge(prev: NetSession, next: In, now: string, isX: boolean): NetSession {
  if (!next) return prev;
  const signedIn = !!next.signedIn;
  const as = isX ? normalizeHandle(next.as) : (next.as || "").trim() || null;
  return {
    signedIn,
    as: signedIn ? as ?? prev.as : prev.as,
    signedOutSince: signedIn ? null : prev.signedIn || !prev.signedOutSince ? now : prev.signedOutSince,
    emailedFor: prev.emailedFor,
  };
}

export async function POST(req: NextRequest) {
  try {
    const caller = await resolvePublishCaller(req);
    if (!caller.ok) {
      return NextResponse.json({ success: false, code: caller.reason, error: "Extension not bound to a workspace" }, { status: 401 });
    }
    const b = (await req.json().catch(() => null)) as { x?: In; linkedin?: In; version?: string; error?: string | null } | null;
    const now = new Date().toISOString();
    const st = await getPublisherState(caller.orgId, caller.clientId);
    st.lastSeenAt = now;
    st.version = b?.version ?? st.version;
    st.x = merge(st.x, b?.x, now, true);
    st.linkedin = merge(st.linkedin, b?.linkedin, now, false);
    if (b?.error !== undefined) st.lastError = b.error;
    await savePublisherState(caller.orgId, st, caller.clientId);
    await sweep(caller.orgId).catch(() => null);

    const settings = await getSettings(caller.orgId);
    const u = await prisma.user.findFirst({
      where: { organizationId: caller.orgId, isActive: true, role: "ADMIN" },
      orderBy: { createdAt: "asc" },
      select: { name: true },
    });
    const f = (u?.name || "").trim().split(/\s+/)[0] || "";
    // A client's own browser is not Gershon's: no Gershon name in its voice. (v4.42.0)
    const lead = caller.clientId ? "" : f.length > 1 ? f + ", " : "";
    return NextResponse.json({
      success: true,
      data: {
        enabled: settings.enabled,
        voice: {
          x: caller.clientId ? "X signed you out. Please sign back in so your scheduled posts can go out." : `${lead}I need you now. Project: Social. Task: X signed you out. Please sign back in so scheduled posts can go out.`,
          linkedin: caller.clientId ? "LinkedIn signed you out. Please sign back in so your scheduled posts can go out." : `${lead}I need you now. Project: Social. Task: LinkedIn signed you out. Please sign back in so scheduled posts can go out.`,
        },
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
