/**
 * Who is asking for posts to publish (v4.42.0).
 *
 *   gp_… key          → a CLIENT's own browser: one company, publishing only.
 *   workspace token   → the workspace's publishing browser (Gershon's): every
 *                       company EXCEPT those set to publish through their own.
 */
import { readExtensionToken, resolveExtensionCaller } from "@/lib/extension-auth";
import { clientRoutedIds, resolvePublishKey } from "@/lib/publishing";

export type PublishCaller =
  | { ok: true; orgId: string; clientId: string | null }
  | { ok: false; reason: string };

export async function resolvePublishCaller(req: Request): Promise<PublishCaller> {
  const token = readExtensionToken(req);
  if (token && token.startsWith("gp_")) {
    const r = await resolvePublishKey(token);
    return r ? { ok: true, orgId: r.orgId, clientId: r.clientId } : { ok: false, reason: "unknown_token" };
  }
  const c = await resolveExtensionCaller(req);
  return c.ok ? { ok: true, orgId: c.orgId, clientId: null } : { ok: false, reason: c.reason };
}

/** Prisma filter: the deliveries this caller is allowed to touch. */
export async function deliveryScope(orgId: string, clientId: string | null): Promise<Record<string, unknown>> {
  if (clientId) return { organizationId: orgId, clientId };
  const routed = await clientRoutedIds(orgId);
  return routed.length
    ? { organizationId: orgId, OR: [{ clientId: null }, { clientId: { notIn: routed } }] }
    : { organizationId: orgId };
}
