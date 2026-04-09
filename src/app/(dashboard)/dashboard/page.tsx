import { Suspense } from "react";
import { DashboardContent } from "@/components/dashboard/dashboard-content";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="animate-pulse text-gray-400">Loading dashboard…</div>}>
      <DashboardContent />
    </Suspense>
  );
}
