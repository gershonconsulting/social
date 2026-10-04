export const runtime = "edge";
/**
 * GET /api/extension/bind
 *
 * How the Chrome extension learns which workspace it collects for — without
 * anybody pasting anything. The extension's content script runs on
 * social.gershoncrm.com pages, calls this with the page's own sign-in cookie,
 * and stores the token it gets back. So the workspace an install collects for
 * is ALWAYS the workspace of the person signed in to the dashboard in that
 * browser. Sign in as Dmitri → VALOS. Sign in as Olivier → Gershon.
 *
 * Added in v4.24.0 together with the removal of the untokened fallback (see
 * lib/extension-auth.ts): an install that has never seen a signed-in
 * dashboard tab is bound to nothing and collects nothing.
 *
 * Viewing-only accounts get no token: collecting WRITES into the workspace.
 */
import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db-raw";
import { getOrCreateExtensionToken } from "@/lib/extension-auth";

export async function GET() {
  try {
    const session = await getSession();
    const user = session?.user;
    if (!user?.id) {
      return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    }
    if (user.role === UserRole.READ_ONLY) {
      return NextResponse.json(
        { success: false, error: "Viewing-only accounts can't collect" },
        { status: 403 },
      );
    }
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, organization: { select: { id: true, name: true } } },
    });
    const org = row?.organization;
    if (!org) {
      return NextResponse.json(
        { success: false, error: "Your account isn't attached to a workspace yet." },
        { status: 409 },
      );
    }
    const token = await getOrCreateExtensionToken(org.id);
    return NextResponse.json(
      {
        success: true,
        data: { token, workspaceId: org.id, workspaceName: org.name, email: row?.email ?? user.email ?? null },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
