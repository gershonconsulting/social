/**
 * Which workspace the Chrome extension is collecting for.
 *
 * The extension runs in somebody's browser against linkedin.com and x.com and
 * posts what it finds back here. It carries no session cookie — it isn't a
 * dashboard tab — so it needs a credential of its own, and that credential has
 * to answer two questions at once: may you write, and WHOSE data is this.
 * One token does both.
 *
 * NO TOKEN, NO WORKSPACE. (v4.24.0)
 * Until v4.24.0 a request with no token fell back to the primary (Gershon)
 * workspace "as a grace period". On 2026-10-04 a fresh install for Dmitri
 * (VALOS) had no token yet, so it was handed Gershon's whole client book and
 * started collecting it. That fallback is gone for good: a request without a
 * token is refused, for every workspace, the primary one included. The
 * extension (0.12.0+) binds itself to a workspace automatically from the
 * signed-in dashboard tab (/api/extension/bind), so there is no manual step to
 * forget — and an install that was never bound collects nothing at all.
 *
 * The token lives in OrgSetting under "extension_token".
 */
import prisma from "@/lib/db-raw";

const KEY = "extension_token";

/** Set once this workspace has been reached with a valid token. Kept as the
 *  "extension is connected" signal for onboarding and the daily report. */
const ENFORCED_KEY = "extension_token_enforced";

export type ExtensionCaller =
  | { ok: true; orgId: string; viaToken: boolean }
  | { ok: false; reason: "unknown_token" | "token_required" | "no_workspace" };

export function readExtensionToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  return req.headers.get("x-gershon-token")?.trim() || null;
}

export async function resolveExtensionCaller(req: Request): Promise<ExtensionCaller> {
  const token = readExtensionToken(req);

  if (token) {
    const row = await prisma.orgSetting.findFirst({
      where: { key: KEY, value: token },
      select: { organizationId: true },
    });
    // A token was offered and it isn't one of ours. Never fall back here —
    // that would turn a wrong token into full access to the primary workspace.
    if (!row) return { ok: false, reason: "unknown_token" };

    // Record that this workspace's extension is connected. Write-once;
    // failing to record it never fails a collection run.
    void markEnforced(row.organizationId);

    return { ok: true, orgId: row.organizationId, viaToken: true };
  }

  // No token = not bound to any workspace. Never guess one.
  return { ok: false, reason: "token_required" };
}

async function markEnforced(orgId: string): Promise<void> {
  try {
    await prisma.orgSetting.upsert({
      where: { organizationId_key: { organizationId: orgId, key: ENFORCED_KEY } },
      create: { organizationId: orgId, key: ENFORCED_KEY, value: new Date().toISOString() },
      update: {},
    });
  } catch {
    // Never let bookkeeping fail a collection run.
  }
}

function mint(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return (
    "gx_" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** This workspace's token, creating one the first time it is asked for. */
export async function getOrCreateExtensionToken(orgId: string): Promise<string> {
  const existing = await prisma.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: KEY } },
  });
  if (existing?.value) return existing.value;

  const value = mint();
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: KEY } },
    create: { organizationId: orgId, key: KEY, value },
    update: { value },
  });
  return value;
}

/** Replace it. Every extension install pointed at this workspace stops until
 *  it is given the new one, which is the point. */
export async function rotateExtensionToken(orgId: string): Promise<string> {
  const value = mint();
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: KEY } },
    create: { organizationId: orgId, key: KEY, value },
    update: { value },
  });
  return value;
}
