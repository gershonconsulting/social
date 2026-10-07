/**
 * Single source of truth for the shipped Chrome-extension version.
 *
 * Bump EXTENSION_LATEST whenever a new build is published to
 * public/gershonai-extension.zip. Consumed by:
 *   - GET /api/extension/version  (the popup's update check)
 *   - the public home page        (download card)
 */
export const EXTENSION_LATEST = "0.13.2";

/** App version — keep in sync with package.json. Shown in the home-page footer. */
export const APP_VERSION = "4.34.0";

// 2026-10-07: account moved to Workers Paid (the free plan's 10 ms CPU cap
// caused the 1102/1101 errors). Redeployed so the deployment picks it up.
