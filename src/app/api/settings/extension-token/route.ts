export const runtime = "edge";
/**
 * The workspace's Chrome-extension token: show it, or replace it.
 *
 * GET mints one on first read, so a new workspace has something to paste into
 * the extension without an extra step. POST rotates, which immediately stops
 * every install still holding the old one — that being the whole point of
 * having a rotate button.
 */
import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { adminScopeFor } from "@/lib/admin-scope";
import { getOrCreateExtensionToken, rotateExtensionToken } from "@/lib/extension-auth";

function authErr(e: unknown): NextResponse | null {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Admins only" }, { status: 403 });
  return null;
}

async function orgOf(): Promise<{ orgId: string } | NextResponse> {
  const actor = await requireRole(UserRole.ADMIN);
  const scope = await adminScopeFor(actor);
  if (!scope.orgId) {
    return NextResponse.json(
      { success: false, error: "Your account isn't attached to a workspace yet." },
      { status: 409 },
    );
  }
  return { orgId: scope.orgId };
}

export async function GET() {
  try {
    const res = await orgOf();
    if (res instanceof NextResponse) return res;
    const token = await getOrCreateExtensionToken(res.orgId);
    return NextResponse.json({ success: true, data: { token } });
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const res = await orgOf();
    if (res instanceof NextResponse) return res;
    const token = await rotateExtensionToken(res.orgId);
    return NextResponse.json({ success: true, data: { token, rotated: true } });
  } catch (e) {
    return authErr(e) ?? NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
