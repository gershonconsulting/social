import { AnalyticsPageClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  return <AnalyticsPageClient />;
}
