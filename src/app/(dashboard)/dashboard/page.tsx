export const runtime = 'edge';
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import { shouldShowOnboarding } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

// Dashboard = dynamic insights + portfolio trend charts (the landing view).
// The classic company-by-company view now lives at /summary.
export default async function DashboardPage() {
  // A workspace with no companies has nothing to draw, so send whoever just
  // signed in to the checklist rather than to a screen of zeroes. One indexed
  // count, and it stops being asked the moment they add a company.
  if (await shouldShowOnboarding()) {
    redirect("/welcome");
  }

  return (
    <Suspense fallback={<div className="animate-pulse text-gray-400">Loading dashboard…</div>}>
      <DashboardOverview />
    </Suspense>
  );
}
