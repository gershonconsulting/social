/**
 * The address of this app — ONE place.
 *
 * v4.43.0 (2026-10-12): the app moved from social.gershoncrm.com to
 * social.gershon.ai. Both domains point at the same Cloudflare Pages project.
 *
 *   - Pages on the old domain are sent to the new one (see src/middleware.ts),
 *     so people, bookmarks and old e-mailed links all land on social.gershon.ai.
 *   - /api/* keeps answering on the old domain, so an extension that has not
 *     been updated yet, the scheduled jobs, and client.gershoncrm.com keep
 *     working during the switch. Never remove the old domain from Pages.
 *
 * NEXT_PUBLIC_APP_URL still wins when set — unless it still names the old
 * domain (Pages keeps the previous value until the next deploy), in which case
 * the new address is used.
 */
export const SITE_HOST = "social.gershon.ai";
export const SITE_ORIGIN = `https://${SITE_HOST}`;

/** Hosts that used to serve this app and now hand page views to SITE_HOST. */
export const LEGACY_HOSTS = ["social.gershoncrm.com"];

export function siteUrl(): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  if (env && !LEGACY_HOSTS.some((h) => env.includes(h))) return env;
  return SITE_ORIGIN;
}
