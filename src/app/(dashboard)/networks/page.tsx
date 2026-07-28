import { CoveragePageClient } from "../admin/coverage/page-client";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

// Networks = per-company link/data/freshness coverage (the 3-green-checks grid).
// Shares the client component with the legacy /admin/coverage route.
export default function NetworksPage() {
  return <CoveragePageClient />;
}
