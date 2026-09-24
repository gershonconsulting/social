"use client";
// Any page under the dashboard that throws shows the self-healing screen
// inside the normal layout, instead of Next's blank "Application error".
import { AutoRecover } from "@/components/layout/auto-recover";

export default function DashboardError({ error }: { error: Error & { digest?: string } }) {
  return <AutoRecover error={error} />;
}
