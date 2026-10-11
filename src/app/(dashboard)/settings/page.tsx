// Thin server shell — heavy work moved to <SettingsPageClient> to avoid the
// edge-runtime resource-limit (Cloudflare Worker error 1102) we were hitting
// when this page ran a Prisma query during SSR.
import { SettingsPageClient } from "./page-client";
import { XAccountCard } from "@/components/settings/x-account-card";
import { PublishingCard } from "@/components/settings/publishing-card";
import { CampaignObjectivesCard } from "@/components/settings/campaign-objectives-card";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <SettingsPageClient />
      {/* v4.16.0 — posts-per-week objective per campaign company (monthly reports). */}
      <CampaignObjectivesCard />
      {/* v4.37.0 — Publishing (LinkedIn + X, replaces HeroPost): live connection + settings. */}
      <PublishingCard />
      {/* v4.8.0 — each workspace connects its own X account. */}
      <XAccountCard />
    </>
  );
}
