export const runtime = 'edge';
import { Suspense } from "react";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export const dynamic = "force-dynamic";

// Summary = the classic dashboard view (KPIs, posting cadence, company cards).
// The top-level "Dashboard" is now the dynamic insights + charts overview.
export default function SummaryPage() {
  return (
    <Suspense fallback={<div className="animate-pulse text-gray-400">Loading summary…</div>}>
      <DashboardContent
        heading="Summary"
        subheading="Company-by-company posting, compliance, and engagement"
      />
    </Suspense>
  );
}
