/**
 * Extension presence heartbeat — storage + comparison helpers.
 *
 * Lives in lib/ (not in the route) because Next.js route modules may only
 * export HTTP verbs, and both /api/extension/seen and the daily progress
 * report need these.
 *
 * The GershonAI Chrome extension already announces itself to every
 * social.gershoncrm.com page (content.js posts GERSHONAI_HELLO and answers
 * GERSHONAI_PING with chrome.runtime.getManifest().version). Until now the
 * server never learned about it, so nothing outside the browser could tell
 * whether a stale build was still installed. ExtensionSeenReporter (mounted
 * in the dashboard layout) forwards that version to /api/extension/seen,
 * which records it here — in the settings table, so no schema change:
 *
 *   settings["ext_installed"] = {
 *     version:     "0.10.7",      // last version that reported in
 *     lastSeenAt:  ISO,           // last time any page saw the extension
 *     firstSeenAt: ISO,           // first sighting of THIS version
 *     previous:    "0.10.6"|null  // version it upgraded from
 *   }
 */

import prisma from "@/lib/db";

export const EXT_SEEN_KEY = "ext_installed";

export interface ExtSeen {
  version: string;
  lastSeenAt: string;
  firstSeenAt: string;
  previous: string | null;
}

/** Numeric dot-segment compare — the same rule the extension popup uses. */
export function semverLt(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export async function readExtSeen(): Promise<ExtSeen | null> {
  const row = await prisma.setting.findUnique({ where: { key: EXT_SEEN_KEY } });
  if (!row?.value) return null;
  try {
    const p = JSON.parse(row.value) as Partial<ExtSeen>;
    if (!p || typeof p.version !== "string") return null;
    return {
      version: p.version,
      lastSeenAt: p.lastSeenAt ?? row.updatedAt.toISOString(),
      firstSeenAt: p.firstSeenAt ?? p.lastSeenAt ?? row.updatedAt.toISOString(),
      previous: p.previous ?? null,
    };
  } catch {
    return null;
  }
}

export async function recordExtSeen(version: string): Promise<ExtSeen> {
  const now = new Date().toISOString();
  const prior = await readExtSeen();
  const changed = prior !== null && prior.version !== version;

  const next: ExtSeen = {
    version,
    lastSeenAt: now,
    firstSeenAt: changed || !prior ? now : prior.firstSeenAt,
    previous: changed ? prior.version : (prior?.previous ?? null),
  };
  const value = JSON.stringify(next);
  await prisma.setting.upsert({
    where: { key: EXT_SEEN_KEY },
    update: { value },
    create: { key: EXT_SEEN_KEY, value },
  });
  return next;
}
