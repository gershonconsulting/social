/**
 * Central sender / recipient resolution for every outbound email this app sends.
 *
 * WHY THIS EXISTS
 * ---------------
 * 1. Resend refuses `onboarding@resend.dev` as a sender for any recipient other
 *    than the account owner (403 validation_error). `gershon.ai` is the only
 *    VERIFIED sending domain on the account, so every email that leaves this app
 *    must come from it.
 * 2. `.github/workflows/deploy.yml` re-writes the Cloudflare Pages secrets
 *    DIGEST_TO / DIGEST_FROM on EVERY deploy, hard-coding the old
 *    `oattia@gmail.com` / `onboarding@resend.dev` values as its fallbacks. The
 *    deploy PAT has no `workflow` scope, so that file cannot be changed from a
 *    session. Therefore the code treats those two specific legacy values as
 *    "unset" — a real override still wins, but the stale ones can't drag the
 *    digest back to the old address.
 *
 * To retire the legacy handling later: set repo variables DIGEST_TO and
 * DIGEST_FROM on gershonconsulting/social (Settings → Secrets and variables →
 * Actions → Variables) to the values below; deploy.yml already prefers
 * `vars.*` over its hard-coded fallbacks.
 */

/** The app's outbound identity. Must stay on the verified gershon.ai domain. */
export const SOCIAL_FROM = "Social GershonCRM <social@gershon.ai>";

/** Who gets the daily "what was collected" digest. */
export const DIGEST_RECIPIENTS = [
  "report@gershonconsulting.com",
  "aina.rama@gershonconsulting.com",
];

/** Values that deploy.yml still injects; treated as if the env var were empty. */
const LEGACY_FROM = new Set(["onboarding@resend.dev", "digest@notifications.gershoncrm.com"]);
const LEGACY_TO = new Set(["oattia@gmail.com"]);

/** Pull the bare address out of `Name <a@b.c>` and normalize it. */
function bareAddress(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return (m ? m[1] : value).trim().toLowerCase();
}

/**
 * Resolve the From header. First non-empty, non-legacy candidate wins:
 * an explicit override (e.g. HEALTH_ALERT_FROM), then DIGEST_FROM, then
 * the verified default.
 */
export function resolveFrom(override?: string | null): string {
  for (const candidate of [override, process.env.DIGEST_FROM]) {
    const value = (candidate || "").trim();
    if (value && !LEGACY_FROM.has(bareAddress(value))) return value;
  }
  return SOCIAL_FROM;
}

/** Split a comma-separated recipient string into a clean list. */
export function parseRecipients(value?: string | null): string[] {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the digest recipients. A real DIGEST_TO override wins; the legacy
 * `oattia@gmail.com` value deploy.yml keeps re-injecting is ignored.
 */
export function resolveDigestTo(): string[] {
  const explicit = parseRecipients(process.env.DIGEST_TO).filter(
    (addr) => !LEGACY_TO.has(addr.toLowerCase()),
  );
  return explicit.length ? explicit : [...DIGEST_RECIPIENTS];
}
