// Thin server shell — heavy work moved to <SettingsPageClient> to avoid the
// edge-runtime resource-limit (Cloudflare Worker error 1102) we were hitting
// when this page ran a Prisma query during SSR.
import { SettingsPageClient } from "./page-client";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsPageClient />;
}
