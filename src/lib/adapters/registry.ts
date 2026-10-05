/**
 * Adapter registry — maps Platform enum values to adapter instances.
 * Add new platform adapters here.
 *
 * v4.29.0: the X / Twitter adapter is wrapped in a credentials gate. When the
 * client's workspace has no working X session in Settings (auth_token + ct0),
 * nothing is fetched from X at all — no homepage, no bundle, no GraphQL.
 */

import { Platform } from "@prisma/client";
import prisma from "@/lib/db";
import { PlatformAdapter, buildUnavailableResult } from "./base";
import { LinkedInAdapter } from "./linkedin";
import { TwitterAdapter } from "./twitter";
import { twitterCollectionEnabled, TWITTER_SKIPPED_REASON } from "@/lib/collect/twitter-gate";
import { AdapterConfig } from "@/types";

async function orgOfClient(clientId: string): Promise<string | null> {
  try {
    const c = await prisma.client.findUnique({ where: { id: clientId }, select: { organizationId: true } });
    return c?.organizationId ?? null;
  } catch {
    return null;
  }
}

function gateTwitter(inner: PlatformAdapter): PlatformAdapter {
  const allowed = async (config: AdapterConfig) => twitterCollectionEnabled(await orgOfClient(config.clientId));
  return {
    platform: inner.platform,
    async fetchPosts(config, since, until) {
      if (!(await allowed(config))) return buildUnavailableResult("NO_TOKEN", TWITTER_SKIPPED_REASON, false);
      return inner.fetchPosts(config, since, until);
    },
    async fetchFollowerCount(config) {
      if (!(await allowed(config))) return null;
      return inner.fetchFollowerCount(config);
    },
    async validateConnection(config) {
      if (!(await allowed(config))) return { valid: false, error: TWITTER_SKIPPED_REASON };
      return inner.validateConnection(config);
    },
  };
}

const adapters: Partial<Record<Platform, PlatformAdapter>> = {
  [Platform.LINKEDIN]: new LinkedInAdapter(),
  [Platform.TWITTER]: gateTwitter(new TwitterAdapter()),
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
