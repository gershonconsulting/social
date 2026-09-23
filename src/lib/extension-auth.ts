/**
 * Which workspace the Chrome extension is collecting for.
 *
 * The extension runs in somebody's browser against linkedin.com and x.com and
 * posts what it finds back here. It carries no session cookie — it isn't a
 * dashboard tab — so it needs a credential of its own, and that credential has
 * to answer two questions at once: may you write, and WHOSE data is this.
 * One token does both.
 *
 * The token lives in OrgSetting under "extension_token" rather than in a
 * column of its own, deliberately: adding it there needs no schema change, and
 * at ten workspaces a lookup by value is a ten-row scan.
 *
 * THE FALLBACK, AND HOW IT CLOSES ITSELF. A request with no token at all is
 * treated as the primary workspace. That is a grace period, not a design: the
 * extension already installed in the operator's browser predates the token,
 * and locking it out would stop collection dead. A request that sends a token
 * we don't recognise is refused outright — only the ABSENCE of one falls back.
 *
 * Rather than leave that hole open until somebody remembers to close it, a
 * workspace closes it itself: the first time one is reached WITH a valid
 * token, that is proof its extension has been updated, and untokened requests
 * for it are refused from then on. So the sequence is exactly right — the old
 * extension keeps working until the moment the new one takes over, and not one
 * request longer. The marker is one row, written once.
 */
import prisma from "@/lib/db-raw";
import { getPrimaryOrganization } from "@/lib/tenancy";

const KEY = "extension_token";

/** Set once this workspace has been reached with a valid token. From then on
 *  an untokened request for it is refused. */
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

    // This workspace's extension is carrying its token, so it no longer needs
    // the grace period. Write-once; failing to record it only means the grace
    // period lasts until the next call.
    void markEnforced(row.organizationId);

    return { ok: true, orgId: row.organizationId, viaToken: true };
  }

  const primary = await getPrimaryOrganization();
  if (!primary) return { ok: false, reason: "no_workspace" };
  if (await isEnforced(primary.id)) return { ok: false, reason: "token_required" };
  return { ok: true, orgId: primary.id, viaToken: false };
}

async function isEnforced(orgId: string): Promise<boolean> {
  const row = await prisma.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: ENFORCED_KEY } },
    select: { id: true },
  });
  return !!row;
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
