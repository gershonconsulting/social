import { getDashboardData, getCollectionStatus } from "./dashboard-content";
import { DashboardOverviewClient } from "./dashboard-overview-client";

// One row per active company — enough for the client to recompute every insight
// list for any category filter without re-hitting the DB.
export interface OverviewRow {
  id: string;
  name: string;
  clientType: string;
  daysSince: number;        // days since last post (999999 = never posted)
  postsThisMonth: number;
  postsLastMonth: number;
  postsLastWeek: number;
  engThisMonth: number;     // likes + comments + shares, this month
}

// One row per enabled platform connection — for the collection-health card,
// filterable by category.
export interface OverviewConn {
  clientType: string;
  state: "collected" | "empty" | "failed" | "stale";
}

export interface OverviewData {
  rows: OverviewRow[];
  conns: OverviewConn[];
  lastUpdate: string | null;
}

function daysSince(dateLocal: string | null): number {
  if (!dateLocal) return 999999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor(
    (today.getTime() - new Date(dateLocal + "T00:00:00Z").getTime()) / 86400000
  );
}

export async function DashboardOverview() {
  const [clients, collection] = await Promise.all([
    getDashboardData(),
    getCollectionStatus(),
  ]);

  const rows: OverviewRow[] = clients.map((c) => {
    const tm = c.buckets?.thisMonth;
    return {
      id: c.id,
      name: c.name,
      clientType: (c.clientType ?? "").toUpperCase(),
      daysSince: daysSince(c.lastPostDateLocal),
      postsThisMonth: c.postsThisMonth,
      postsLastMonth: c.postsLastMonth,
      postsLastWeek: c.buckets?.lastWeek?.posts ?? 0,
      engThisMonth: tm ? tm.likes + tm.comments + tm.shares : 0,
    };
  });

  // Attach clientType to each connection so collection health can be filtered
  // by category too.
  const typeById = new Map(rows.map((r) => [r.id, r.clientType]));
  const conns: OverviewConn[] = collection.connections.map((c) => ({
    clientType: typeById.get(c.clientId) ?? "",
    state: c.state,
  }));

  return (
    <DashboardOverviewClient
      data={{ rows, conns, lastUpdate: collection.lastUpdate }}
    />
  );
}
