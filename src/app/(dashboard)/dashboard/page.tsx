export const runtime = 'edge';
import { Suspense } from "react";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";

export const dynamic = "force-dynamic";

// Dashboard = dynamic insights + portfolio trend charts (the landing view).
// The classic company-by-company view now lives at /summary.
export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="animate-pulse text-gray-400">Loading dashboard…</div>}>
      <DashboardOverview />
    </Suspense>
  );
}
