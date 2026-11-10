/**
 * One-click "Done" / "Dismiss" links in the report emails (v4.70.0).
 *
 * The email is opened by people who are not signed in to Social (sales@, a
 * client's admin on their phone), so the link itself carries the proof: an
 * HMAC-SHA256 over workspace + card + status, keyed with NEXTAUTH_SECRET.
 * A link can only do the one thing it says, for the one card it names.
 */
import { SITE } from "@/lib/reports/ops/shell";
import type { ActionStatus } from "./store";

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || "";
}

function b64url(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signAction(orgId: string, id: string, status: ActionStatus): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`intel-action|${orgId}|${id}|${status}`));
  return b64url(mac).slice(0, 32);
}

export async function verifyAction(orgId: string, id: string, status: ActionStatus, token: string): Promise<boolean> {
  if (!secret() || !token) return false;
  const want = await signAction(orgId, id, status);
  if (want.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** The link to put in an email. Lives under /api/report/ (machine path: no session, own check). */
export async function actionLink(orgId: string, id: string, status: ActionStatus): Promise<string> {
  const t = await signAction(orgId, id, status);
  return `${SITE}/api/report/action?o=${encodeURIComponent(orgId)}&a=${encodeURIComponent(id)}&s=${status}&t=${t}`;
}
