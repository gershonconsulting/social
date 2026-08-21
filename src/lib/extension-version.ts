/**
 * Single source of truth for the shipped Chrome-extension version.
 *
 * Bump EXTENSION_LATEST whenever a new build is published to
 * public/gershonai-extension.zip. Consumed by:
 *   - GET /api/extension/version  (the popup's update check)
 *   - the public home page        (download card)
 */
export const EXTENSION_LATEST = "0.10.7";

/** App version — keep in sync with package.json. Shown in the home-page footer. */
export const APP_VERSION = "3.5.0";
