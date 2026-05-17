export const runtime = 'edge';
import { NextResponse } from "next/server";

/**
 * GET /api/extension/version
 *
 * Returns the latest shipped version of the Watchman Chrome extension.
 * The popup compares this against its installed version
 * (chrome.runtime.getManifest().version) and shows an "Update available"
 * banner if installed < latest.
 *
 * Bump LATEST whenever I publish a new version of the extension files
 * to the workspace folder. Keep semver — popup does a string-compare-aware
 * version diff (treating each dot-separated segment as a number).
 */
const LATEST = "0.5.0";

const RELEASE_NOTES: Record<string, string> = {
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
      // How to install/update (rendered in the popup banner if installed < latest)
      updateInstructions: "Open chrome://extensions/ and click the reload icon on the Watchman card.",
    },
  });
}
