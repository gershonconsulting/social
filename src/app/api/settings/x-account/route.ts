export const runtime = "edge";
/**
 * "Your X account" — connect the signed-in user's X (Twitter) account to
 * THEIR workspace.
 *
 * GET    → { connected, handle, capturedAt, source, ownClientId }
 * POST   → { handle?, authToken?, ct0? }
 *          - handle alone: record which X account is theirs and make sure it
 *            is collected (an INTERNAL company in their workspace with an X
 *            connection). The session can then come from the extension.
 *          - authToken + ct0: store the X session for the workspace. Every X
 *            account in the workspace — theirs, clients, partners,
 *            competition — is then read with it.
 * DELETE → forget the session (and the handle).
 *
 * No X password is ever asked for or stored — see lib/x-session.ts.
 * Admin of the workspace only: the session is a credential that acts for
 * the whole workspace.
 */
import { NextRequest, NextResponse } from "next/server";
import { UserRole, Platform, ClientType, ClientStatus } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/db-raw";
import { requireRole } from "@/lib/auth";
import { adminScopeFor } from "@/lib/admin-scope";
import {
  clearOrgCookies,
  getOrgCookies,
  getXHandle,
  normalizeXHandle,
  saveOrgCookies,
  setXHandle,
} from "@/lib/x-session";

function authErr(e: unknown): NextResponse | null {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Admins only" }, { status: 403 });
  return null;
}

async function orgOf(): Promise<{ orgId: string; userName: string } | NextResponse> {
  const actor = await requireRole(UserRole.ADMIN);
  const scope = await adminScopeFor(actor);
  if (!scope.orgId) {
    return NextResponse.json(
      { success: false, error: "Your account isn't attached to a workspace yet." },
      { status: 409 },
    );
  }
  return { orgId: scope.orgId, userName: actor.name || "" };
}

async function findOwnClient(orgId: string, handle: string) {
  const conns = await prisma.platformConnection.findMany({
    where: { organizationId: orgId, platform: Platform.TWITTER },
    select: { id: true, clientId: true, externalAccountUrl: true, externalAccountName: true },
  });
  const h = handle.toLowerCase();
  return (
    conns.find(
      (c) =>
        normalizeXHandle(c.externalAccountUrl)?.toLowerCase() === h ||
        normalizeXHandle(c.externalAccountName)?.toLowerCase() === h,
    ) ?? null
  );
}

/** Make sure the user's own X account is tracked in their workspace. */
async function ensureOwnClient(orgId: string, handle: string, displayName: string): Promise<string> {
  const existing = await findOwnClient(orgId, handle);
  if (existing) {
    await prisma.platformConnection.update({
      where: { id: existing.id },
      data: { isEnabled: true, connectionStatus: "CONNECTED", lastSyncError: null },
    });
    return existing.clientId;
  }

  const base = ("x-" + handle.toLowerCase()).replace(/[^a-z0-9-]/g, "-").slice(0, 60);
  let slug = base;
  for (let i = 2; await prisma.client.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }
  const client = await prisma.client.create({
    data: {
      slug,
      name: displayName || "@" + handle,
      status: ClientStatus.ACTIVE,
      clientType: ClientType.INTERNAL,
      organizationId: orgId,
      notes: "Your own X account — added when you connected X in Settings.",
    },
  });
  await prisma.platformConnection.create({
    data: {
      clientId: client.id,
      organizationId: orgId,
      platform: Platform.TWITTER,
      externalAccountName: handle,
      externalAccountUrl: `https://x.com/${handle}`,
      isEnabled: true,
      connectionStatus: "CONNECTED",
    },
  });
  return client.id;
}

export async function GET() {
  try {
    const o = await orgOf();
    if (o instanceof NextResponse) return o;
    const [b, handle] = await Promise.all([getOrgCookies(o.orgId, "TWITTER"), getXHandle(o.orgId)]);
    const own = handle ? await findOwnClient(o.orgId, handle) : null;
    return NextResponse.json({
      success: true,
      data: {
        connected: !!(b.cookies.auth_token && b.cookies.ct0),
        handle,
        capturedAt: b.capturedAt,
        source: b.source ?? null,
        ownClientId: own?.clientId ?? null,
      },
    });
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}

const schema = z.object({
  handle: z.string().max(100).optional().nullable(),
  authToken: z.string().max(400).optional().nullable(),
  ct0: z.string().max(400).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const o = await orgOf();
    if (o instanceof NextResponse) return o;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });

    const rawHandle = parsed.data.handle?.trim() || "";
    const handle = rawHandle ? normalizeXHandle(rawHandle) : null;
    if (rawHandle && !handle) {
      return NextResponse.json(
        { success: false, error: "That doesn't look like an X handle — use the @name or the x.com/… link." },
        { status: 400 },
      );
    }

    const authToken = parsed.data.authToken?.trim() || "";
    const ct0 = parsed.data.ct0?.trim() || "";
    if ((authToken && !ct0) || (!authToken && ct0)) {
      return NextResponse.json({ success: false, error: "Both auth_token and ct0 are needed." }, { status: 400 });
    }
    if (authToken && (authToken.length < 20 || ct0.length < 20)) {
      return NextResponse.json({ success: false, error: "auth_token and ct0 look too short." }, { status: 400 });
    }
    if (!handle && !authToken) {
      return NextResponse.json({ success: false, error: "Give your X handle, your session, or both." }, { status: 400 });
    }

    let ownClientId: string | null = null;
    if (handle) {
      await setXHandle(o.orgId, handle);
      ownClientId = await ensureOwnClient(o.orgId, handle, o.userName);
    }
    if (authToken) {
      await saveOrgCookies(o.orgId, "TWITTER", { auth_token: authToken, ct0 }, { source: "manual" });
      // Connections that failed for lack of a session get another chance.
      await prisma.platformConnection.updateMany({
        where: { organizationId: o.orgId, platform: Platform.TWITTER, connectionStatus: { not: "CONNECTED" } },
        data: { connectionStatus: "CONNECTED", lastSyncError: null },
      });
    }

    const tw = await prisma.platformConnection.count({
      where: { organizationId: o.orgId, platform: Platform.TWITTER, isEnabled: true },
    });
    return NextResponse.json({
      success: true,
      data: {
        handle: handle ?? (await getXHandle(o.orgId)),
        sessionSaved: !!authToken,
        ownClientId,
        xAccountsInWorkspace: tw,
      },
    });
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const o = await orgOf();
    if (o instanceof NextResponse) return o;
    await clearOrgCookies(o.orgId, "TWITTER");
    await setXHandle(o.orgId, null);
    return NextResponse.json({ success: true, data: { disconnected: true } });
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
