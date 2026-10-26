export const runtime = 'edge';
import { Suspense } from "react";
import { EcosystemSummary } from "@/components/dashboard/ecosystem-dashboard";

export const dynamic = "force-dynamic";

// v4.65.0: Social's ecosystem Summary — one row per tracked company, every
// category (narrowed by the sidebar filter). Compliance/objectives live in
// Social Tracking now.
export default function SummaryPage() {
  return (
    <Suspense fallback={<div className="animate-pulse text-gray-400">Loading summary…</div>}>
      <EcosystemSummary />
    </Suspense>
  );
}
