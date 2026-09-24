/**
 * Which workspace a request is acting for, when it may come from EITHER a
 * signed-in dashboard tab OR the Chrome extension (which carries a workspace
 * token instead of a login). Session wins; the extension token is the
 * fallback. Used by the cookie-capture routes.
 */
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db-raw";
import { resolveExtensionCaller } from "@/lib/extension-auth";

export type OrgResolution =
  | { ok: true; orgId: string; via: "session" | "extension" }
  | { ok: false; status: number; error: string };

export async function orgFromSession(): Promise<string | null> {
  const s = await getSession();
  if (!s?.user?.id) return null;
  if (s.user.organizationId) return s.user.organizationId;
  const u = await prisma.user.findUnique({ where: { id: s.user.id }, select: { organizationId: true } });
  return u?.organizationId ?? null;
}

export async function resolveRequestOrg(req: Request): Promise<OrgResolution> {
  const fromSession = await orgFromSession();
  if (fromSession) return { ok: true, orgId: fromSession, via: "session" };

  const caller = await resolveExtensionCaller(req);
  if (caller.ok) return { ok: true, orgId: caller.orgId, via: "extension" };
  const error =
    caller.reason === "unknown_token"
      ? "Unknown workspace token. Copy it again from Settings → This computer."
      : caller.reason === "token_required"
        ? "This workspace requires its token. Paste it into the GershonAI extension."
        : "No workspace found.";
  return { ok: false, status: 401, error };
}
