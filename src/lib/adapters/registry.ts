/**
 * Adapter registry — maps Platform enum values to adapter instances.
 * Add new platform adapters here.
 */

import { Platform } from "@prisma/client";
import { PlatformAdapter } from "./base";
import { LinkedInAdapter } from "./linkedin";
import { TwitterAdapter } from "./twitter";
import { GoogleBusinessAdapter } from "./google-business";

const adapters: Partial<Record<Platform, PlatformAdapter>> = {
  [Platform.LINKEDIN]: new LinkedInAdapter(),
  [Platform.TWITTER]: new TwitterAdapter(),
  [Platform.GOOGLE_BUSINESS]: new GoogleBusinessAdapter(),
};

/**
 * Get the adapter for a given platform, or null if not yet implemented.
 */
export function getAdapter(platform: Platform): PlatformAdapter | null {
  return adapters[platform] ?? null;
}

/**
 * Get all platforms that have a registered adapter.
 */
export function getSupportedPlatforms(): Platform[] {
  return Object.keys(adapters) as Platform[];
}
