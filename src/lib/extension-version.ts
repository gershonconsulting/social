/**
 * Single source of truth for the shipped Chrome-extension version.
 *
 * Bump EXTENSION_LATEST whenever a new build is published to
 * public/social-extension-v<version>.zip. Consumed by:
 *   - GET /api/extension/version  (the popup's update check)
 *   - the public home page        (download card)
 */
export const EXTENSION_LATEST = "0.25.1";

/**
 * The download carries its version in the file name, like the other Gershon
 * extensions (radar-extension-v1.15.0.zip, nexashare-extension-1.2.27.zip),
 * so a downloaded file always says which build it is. Written at build time by
 * scripts/build-extension.mjs from extension-src/manifest.json; the build
 * fails if that version and EXTENSION_LATEST differ. The unversioned
 * social-extension.zip / gershonai-extension.zip stay as aliases for old links.
 */
export const EXTENSION_ZIP_NAME = `social-extension-v${EXTENSION_LATEST}.zip`;
export const EXTENSION_ZIP_URL = `/${EXTENSION_ZIP_NAME}`;

/** App version — keep in sync with package.json. Shown in the home-page footer. */
export const APP_VERSION = "4.63.0";

// 2026-10-07: account moved to Workers Paid (the free plan's 10 ms CPU cap
// caused the 1102/1101 errors). Redeployed so the deployment picks it up.
