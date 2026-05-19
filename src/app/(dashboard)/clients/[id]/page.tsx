// Thin server shell — heavy work moved to <ClientDetailPageClient> to avoid
// the edge-runtime resource-limit (Cloudflare Worker error 1102) we were
// hitting when this page ran a Prisma query with nested includes during SSR.
// Same pattern as the /clients list page.
import { ClientDetailPageClient } from "./page-client";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientDetailPageClient clientId={id} />;
}
