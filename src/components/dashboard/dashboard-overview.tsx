import { getDashboardData, getCollectionStatus } from "./dashboard-content";
import { DashboardOverviewClient } from "./dashboard-overview-client";

export interface OverviewCompanyRef {
  id: string;
  name: string;
  value: number;
  sub?: string;
}

export interface OverviewInsights {
  totalCompanies: number;
  collection: {
    collected: number;
    total: number;
    failed: number;
    stale: number;
    empty: number;
    lastUpdate: string | null;
  };
  silent: { count: number; companies: OverviewCompanyRef[] };
  quiet: { count: number };
  active: { count: number };
  movers: OverviewCompanyRef[];
  mostActive: OverviewCompanyRef[];
  engagementLeaders: OverviewCompanyRef[];
}

function daysSince(dateLocal: string | null): number {
  if (!dateLocal) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor(
    (today.getTime() - new Date(dateLocal + "T00:00:00Z").getTime()) / 86400000
  );
}

async function buildInsights(): Promise<OverviewInsights> {
  const [clients, collection] = await Promise.all([
    getDashboardData(),
    getCollectionStatus(),
  ]);

  // --- Posting cadence buckets ---
  let silentCount = 0;
  let quietCount = 0;
  let activeCount = 0;
  const silentCompanies: OverviewCompanyRef[] = [];
  for (const c of clients) {
    const d = daysSince(c.lastPostDateLocal);
    if (d > 30) {
      silentCount++;
      silentCompanies.push({
        id: c.id,
        name: c.name,
        value: Number.isFinite(d) ? d : 9999,
        sub: Number.isFinite(d) ? `${d} days silent` : "never posted",
      });
    } else if (d > 14) {
      quietCount++;
    } else {
      activeCount++;
    }
  }
  silentCompanies.sort((a, b) => b.value - a.value);

  // --- Movers: month-over-month post volume change ---
  const movers: OverviewCompanyRef[] = clients
    .map((c) => ({
      id: c.id,
      name: c.name,
      delta: c.postsThisMonth - c.postsLastMonth,
      thisMonth: c.postsThisMonth,
      lastMonth: c.postsLastMonth,
    }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      name: m.name,
      value: m.delta,
      sub:
        (m.delta > 0 ? "+" : "") +
        `${m.delta} vs last month (${m.lastMonth}→${m.thisMonth})`,
    }));

  // --- Most active this week (last 7 days) ---
  const mostActive: OverviewCompanyRef[] = clients
    .map((c) => ({ id: c.id, name: c.name, posts: c.buckets?.lastWeek?.posts ?? 0 }))
    .filter((c) => c.posts > 0)
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 5)
    .map((c) => ({ id: c.id, name: c.name, value: c.posts, sub: `${c.posts} posts` }));

  // --- Engagement leaders this month ---
  const engagementLeaders: OverviewCompanyRef[] = clients
    .map((c) => {
      const b = c.buckets?.thisMonth;
      const eng = b ? b.likes + b.comments + b.shares : 0;
      return { id: c.id, name: c.name, eng };
    })
    .filter((c) => c.eng > 0)
    .sort((a, b) => b.eng - a.eng)
    .slice(0, 5)
    .map((c) => ({ id: c.id, name: c.name, value: c.eng, sub: `${c.eng.toLocaleString()} this month` }));

  return {
    totalCompanies: clients.length,
    collection: {
      collected: collection.counts.collected,
      total: collection.totalConfigured,
      failed: collection.counts.failed,
      stale: collection.counts.stale,
      empty: collection.counts.empty,
      lastUpdate: collection.lastUpdate,
    },
    silent: { count: silentCount, companies: silentCompanies.slice(0, 6) },
    quiet: { count: quietCount },
    active: { count: activeCount },
    movers,
    mostActive,
    engagementLeaders,
  };
}

export async function DashboardOverview() {
  const insights = await buildInsights();
  return <DashboardOverviewClient insights={insights} />;
}
