export const runtime = 'edge';
import { NextResponse } from "next/server";

/**
 * GET /api/extension/version
 *
 * Returns the latest shipped version of the GershonAI Chrome extension.
 * The popup compares this against its installed version and shows an
 * "Update available" banner if installed < latest.
 *
 * Bump LATEST whenever a new version of the extension files is published
 * to public/gershonai-extension.zip. Keep semver — popup does a numeric
 * dot-segment compare.
 */
const LATEST = "0.10.6";

const RELEASE_NOTES: Record<string, string> = {
  "0.10.6": "Auto-reauth on LinkedIn — when your LinkedIn session has expired the extension now drives the login wall itself: clicks the saved-account button, lets Chrome's password autofill populate the password, and submits the form before resuming the scrape.",
  "0.10.5": "Smarter sync: only opens the LinkedIn / X tabs the targeted client actually has. A Twitter-only client no longer triggers a LinkedIn cookie capture attempt.",
  "0.10.4": "Detailed per-step log of each sync run. Click 'View detailed log' in the popup to see exactly which cookies were found, which domains were checked, per-platform capture and scrape results, and ingest errors. Also expands LinkedIn cookie lookup to www.linkedin.com + fr.linkedin.com domains.",
  "0.10.3": "Per-client refresh from the company detail page. The Sync Now button there now drives the extension via a postMessage bridge instead of going through Phantombuster — opens LinkedIn + X in your browser, scrapes only that client.",
  "0.10.2": "X tab stays open after Sync Now so you can inspect what x.com is rendering when auth_token isn't found (logged out / partitioned / interstitial). Also activates the tab so it pops to the foreground.",
  "0.10.1": "More robust X cookie capture — looks for auth_token on x.com AND twitter.com domains (Twitter still sets the legacy domain in some flows). Longer settle time on x.com home tab. Fixes the symptom where the X tab opened and immediately closed without saving cookies.",
  "0.10.0": "Daily auto-sync. The extension now runs the Sync Now flow once a day on its own via chrome.alarms — no clicking needed as long as Chrome is open. If Chrome was closed, the server falls back to Phantombuster at 06:00 UTC.",
  "0.9.0": "Major: posts are now fetched inside YOUR browser (your real IP + cookies) — bypasses LinkedIn/X anti-bot that was rejecting our edge requests.",
  "0.8.1": "Fix: TypeError when re-enabling the Sync Now button (e.currentTarget null after await).",
  "0.8.0": "Sync Now now scrapes ALL clients (loops chunks until done) and shows running totals.",
  "0.7.0": "Branded icon (G + Golden Gate Bridge) now shown in the Chrome toolbar.",
  "0.6.0": "Renamed to GershonAI.",
  "0.5.0": "After Sync Now, also triggers server-side scrape so fresh posts arrive in the dashboard immediately.",
  "0.4.0": "Single 'Sync Now' button — opens LinkedIn + X in sequence, captures both cookie sets in one click.",
  "0.3.0": "Visible version + auto update banner.",
  "0.2.0": "Cookie capture: two buttons to refresh LinkedIn + X sessions.",
  "0.1.0": "Initial release (deprecated): auto-scrape on browse.",
};

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      latest: LATEST,
      releaseNotes: RELEASE_NOTES[LATEST] ?? "",
      updateInstructions: "Open chrome://extensions/ and click the reload icon on the GershonAI card.",
    },
  });
}
