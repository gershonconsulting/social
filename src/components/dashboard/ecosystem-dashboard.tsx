import { getEcosystemData } from "@/lib/ecosystem/data";
import { EcosystemDashboardClient } from "./ecosystem-dashboard-client";
import { EcosystemSummaryClient } from "./ecosystem-summary-client";

/** Social's own Dashboard (v4.65.0) — "Who is posting what". */
export async function EcosystemDashboard() {
  const data = await getEcosystemData({ withPosts: true });
  return <EcosystemDashboardClient data={data} />;
}

/** Social's own Summary (v4.65.0) — one row per tracked company. */
export async function EcosystemSummary() {
  const data = await getEcosystemData();
  return <EcosystemSummaryClient data={data} />;
}
