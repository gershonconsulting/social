export const runtime = 'edge';
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EcosystemDashboard } from "@/components/dashboard/ecosystem-dashboard";
import { shouldShowOnboarding } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

// v4.65.0: Social's own Dashboard — "Who is posting what" across the whole
// tracked ecosystem. The campaign command center moved to Social Tracking.
export default async function DashboardPage() {
  // A workspace with no companies has nothing to draw, so send whoever just
  // signed in to the checklist rather than to a screen of zeroes.
  if (await shouldShowOnboarding()) {
    redirect("/welcome");
  }

  return (
    <Suspense fallback={<div className="animate-pulse text-gray-400">Loading dashboard…</div>}>
      <EcosystemDashboard />
    </Suspense>
  );
}
