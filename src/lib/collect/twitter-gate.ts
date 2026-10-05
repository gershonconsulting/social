/**
 * v4.29.0 — X / Twitter collection gate.
 *
 * Olivier's rule: no time is spent searching X unless working X credentials
 * are on file in Settings. "Working" = an X session with both auth_token and
 * ct0 (the only credential X accepts — see lib/x-session.ts). Without it every
 * X request comes back logged-out, so the whole X pass is skipped.
 */
import { getOrgCookies } from "@/lib/x-session";

const cache = new Map<string, boolean>();

export async function twitterCollectionEnabled(orgId: string | null): Promise<boolean> {
  if (!orgId) return false;
  const hit = cache.get(orgId);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const b = await getOrgCookies(orgId, "TWITTER");
    ok = !!(b.cookies.auth_token && b.cookies.ct0);
  } catch {
    ok = false;
  }
  cache.set(orgId, ok);
  return ok;
}

export function resetTwitterGateCache(): void {
  cache.clear();
}

export const TWITTER_SKIPPED_REASON = "Skipped — no working X / Twitter credentials in Settings";
