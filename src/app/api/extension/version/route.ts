export const runtime = 'edge';
import { NextResponse } from "next/server";
import { EXTENSION_LATEST, EXTENSION_ZIP_URL } from "@/lib/extension-version";

/**
 * GET /api/extension/version
 *
 * Returns the latest shipped version of the GershonAI Chrome extension.
 * The popup compares this against its installed version and shows an
 * "Update available" banner if installed < latest.
 *
 * Bump LATEST whenever a new version of the extension files is published
 * to public/social-extension-v<version>.zip. Keep semver — popup does a numeric
 * dot-segment compare.
 */
const LATEST = EXTENSION_LATEST;

const RELEASE_NOTES: Record<string, string> = {
  "0.20.0": "Really in the background. Collection and publishing now run in a minimized window that never covers your screen or pulls Chrome to the front; the LinkedIn and X pages inside it are told they are on screen, so they still load (tested on LinkedIn: 0 posts in a hidden tab before, 12 with this). If a post fails before the Post click in the minimized window, its retry uses a normal window. The extension also updates itself: when its folder holds a newer version, it reloads on its own once nothing is running. Sign-out alerts still come to the front on purpose.",
  "0.19.0": "Works in the background on request. Every minute the extension checks social.gershon.ai for a collection someone asked for — from any browser or a phone, no dashboard tab needed here — then collects in its own window and reports back. The dashboard now shows which Chromes are listening and the extension version each one runs.",
  "0.18.0": "New address. The dashboard moved to social.gershon.ai. The extension now works on that address (and still recognises the old social.gershoncrm.com pages), so collection and publishing carry on without a break. Open social.gershon.ai once in this browser while signed in and the extension reconnects itself.",
  "0.17.0": "Client publishing. A company can now publish its approved posts from its OWN Chrome: open the private link Gershon sends you (social.gershon.ai/connect/…) and this extension connects to that company only. It then publishes only that company's approved posts at their scheduled time, and collects nothing. Your LinkedIn and X sessions never leave your browser.",
  "0.16.0": "Pictures. Every post approved on social.gershon.ai/publishing now goes out on LinkedIn and X with its picture (one per post): the extension attaches it in each network's own post box, waits until it is uploaded, and only then presses Post. If the picture cannot be attached, nothing is posted and it is retried.",
  "0.15.0": "Publishing (replaces HeroPost). Posts approved on social.gershon.ai/publishing go out on LinkedIn and X at the same time, from this browser, then are checked on the page. The X connection is watched like LinkedIn already was: if X signs this browser out, the extension says so out loud, opens the X login page (your password manager fills it), shows a red X badge, and the dashboard emails you. No password is stored.",
  "0.14.0": "LinkedIn sign-out watchdog. The moment LinkedIn signs this browser out, the extension says so out loud, opens the LinkedIn login page in the window you are using (your password manager fills it in one click), shows a notification and a red IN badge, and the dashboard emails you once. It repeats every 10 minutes while you stay signed out. It only reads this browser's own cookies — it sends nothing to LinkedIn and never types a password.",
  "0.11.0": "Workspace token. One extension now serves every workspace: paste the token from Settings → This computer and what this browser collects lands in that workspace and no other. Without a token it keeps feeding the original workspace, so nothing breaks before you set it — but that fallback closes for a workspace as soon as it sees its first tokened request.",
  "0.10.7": "Fix: posts are now scraped from the real profile pages — linkedin.com/company/<vanity>/posts/ and x.com/<handle> — by reading the rendered DOM. Drops the deprecated voyager + v1.1 user_timeline endpoints that started failing in 2026 (LinkedIn rejected our csrf because JSESSIONID is HttpOnly; X v1.1 user_timeline is locked behind the paid API plan). The Sync via extension popover now also surfaces the per-platform error instead of just \"N failed\".",
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
      downloadUrl: EXTENSION_ZIP_URL,
      releaseNotes: RELEASE_NOTES[LATEST] ?? "",
      updateInstructions: "Open chrome://extensions/ and click the reload icon on the GershonAI card.",
    },
  });
}
