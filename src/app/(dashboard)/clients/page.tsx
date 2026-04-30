// Thin server shell — heavy work moved to <ClientsPageClient> to avoid the
// edge-runtime resource-limit (Cloudflare Worker error 1102) we were hitting
// when this page ran a big Prisma query during SSR.
import { ClientsPageClient } from "./page-client";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

export default function ClientsPage() {
  return <ClientsPageClient />;
}
