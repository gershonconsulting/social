/**
 * Dashboard data — v4.58.0, "Campaign command center".
 *
 * Olivier, 2026-10-21, looking at the v4.10 manager view: "Seriously? That's
 * the best dashboard we can do" … "we only care about campaigns".
 *
 * So this page is now hard-scoped to CAMPAIGN companies (the sidebar category
 * filter does not apply here) and carries real numbers again: posting volume
 * against each company's weekly objective, engagement, views, followers per
 * company, top posts and collection health. (v4.65.0: the publishing
 * pipeline and content runway left for Publish.)
 *
 * Everything is aggregated in the database (GROUP BY) — never load raw posts
 * into the edge worker (see project_social_outage_2026_08_21). With only the
 * campaign book (≈6 companies) the daily rows stay in the low thousands.
 */
import prisma from "@/lib/db";
import { getCollectionStatus } from "./dashboard-content";
import { DashboardOverviewClient } from "./dashboard-overview-client";
import { getCurrentOrgId } from "@/lib/scoped-db";
import { objectivesFor, DEFAULT_PER_WEEK } from "@/lib/campaigns/objectives";

export interface DashCompany {
  id: string;
  name: string;
  logoUrl: string | null;
  perWeek: number;
  campaignStart: string | null;       // YYYY-MM-DD (campaignStartDate, else first collected post)
  networks: string[];                 // LINKEDIN / TWITTER with an enabled connection
  lastPost: string | null;            // YYYY-MM-DD
  followers: Array<{ platform: string; now: number; then: number | null }>;
}

/** [companyIndex, platform 0=LinkedIn 1=X, date YYYY-MM-DD, posts, engagement, views] */
export type DayRow = [number, number, string, number, number, number];
/** [companyIndex, platform, YYYY-MM, posts, engagement, views] */
export type MonthRow = [number, number, string, number, number, number];

/** [companyIndex, YYYY-MM, weekdays with any post, with a LinkedIn post, with an X post] */
export type CoverRow = [number, string, number, number, number];

export interface TopPost {
  c: number;              // company index
  platform: string;
  date: string;
  url: string | null;
  text: string;
  likes: number;
  comments: number;
  shares: number;
  views: number;
}

export interface DashData {
  companies: DashCompany[];
  days: DayRow[];
  months: MonthRow[];
  cover: CoverRow[];
  top: TopPost[];
  collection: { state: string; platform: string; companyIdx: number; lastSyncAt: string | null }[];
  lastUpdate: string | null;
  today: string;
}

const PLAT_IDX: Record<string, number> = { LINKEDIN: 0, TWITTER: 1 };

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function DashboardOverview() {
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE", clientType: "CAMPAIGN" },
    select: { id: true, name: true, logoUrl: true, campaignStartDate: true },
    orderBy: { name: "asc" },
  });
  const ids = clients.map((c) => c.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const now = new Date();
  const today = isoDay(now);
  const since = new Date(now);
  since.setDate(since.getDate() - 400);
  const sinceDay = isoDay(since);
  const f30 = new Date(now);
  f30.setDate(f30.getDate() - 30);
  const f30Day = isoDay(f30);

  type Agg = { clientId: string; platform: string; k: string; n: number; e: number; v: number };
  type Top = { clientId: string; platform: string; d: string; url: string | null; t: string | null; l: number; c: number; s: number; v: number };
  type Cov = { clientId: string; k: string; a: number; li: number; x: number };
  type Fol = { clientId: string; platform: string; n: number };

  const none = <T,>() => Promise.resolve([] as T[]);
  const orgId = await getCurrentOrgId().catch(() => null);

  const [cover, daily, monthly, top, folNow, folThen, conns, collection, obj] =
    await Promise.all([
      // Weekdays (Mon–Fri) that had at least one post, per company per month.
      ids.length
        ? prisma.$queryRaw<Cov[]>`
            SELECT "clientId", substr("publishedDateLocal",1,7) AS k,
                   COUNT(DISTINCT "publishedDateLocal")::int AS a,
                   COUNT(DISTINCT "publishedDateLocal") FILTER (WHERE platform::text = 'LINKEDIN')::int AS li,
                   COUNT(DISTINCT "publishedDateLocal") FILTER (WHERE platform::text = 'TWITTER')::int AS x
            FROM social_posts
            WHERE "clientId" = ANY(${ids}) AND platform::text IN ('LINKEDIN','TWITTER')
              AND EXTRACT(ISODOW FROM to_date("publishedDateLocal", 'YYYY-MM-DD')) < 6
            GROUP BY 1,2`
        : none<Cov>(),
      ids.length
        ? prisma.$queryRaw<Agg[]>`
            SELECT "clientId", platform::text AS platform, "publishedDateLocal" AS k,
                   COUNT(*)::int AS n,
                   COALESCE(SUM("likeCount" + "commentCount" + "shareCount"),0)::int AS e,
                   COALESCE(SUM("viewCount"),0)::int AS v
            FROM social_posts
            WHERE "clientId" = ANY(${ids}) AND "publishedDateLocal" >= ${sinceDay}
              AND platform::text IN ('LINKEDIN','TWITTER')
            GROUP BY 1,2,3`
        : none<Agg>(),
      ids.length
        ? prisma.$queryRaw<Agg[]>`
            SELECT "clientId", platform::text AS platform, substr("publishedDateLocal",1,7) AS k,
                   COUNT(*)::int AS n,
                   COALESCE(SUM("likeCount" + "commentCount" + "shareCount"),0)::int AS e,
                   COALESCE(SUM("viewCount"),0)::int AS v
            FROM social_posts
            WHERE "clientId" = ANY(${ids}) AND platform::text IN ('LINKEDIN','TWITTER')
            GROUP BY 1,2,3`
        : none<Agg>(),
      // Each company's best posts: top 6 of the last 400 days + top 3 all time.
      ids.length
        ? prisma.$queryRaw<Top[]>`
            SELECT "clientId", platform, d, url, t, l, c, s, v FROM (
              SELECT "clientId", platform::text AS platform, "publishedDateLocal" AS d, "postUrl" AS url,
                     LEFT(COALESCE("postTextSnippet", "postTextFull", ''), 220) AS t,
                     "likeCount" AS l, "commentCount" AS c, "shareCount" AS s, "viewCount" AS v,
                     ROW_NUMBER() OVER (PARTITION BY "clientId", ("publishedDateLocal" >= ${sinceDay})
                                        ORDER BY ("likeCount" + "commentCount" + "shareCount") DESC) AS rn,
                     ("publishedDateLocal" >= ${sinceDay}) AS recent
              FROM social_posts
              WHERE "clientId" = ANY(${ids}) AND platform::text IN ('LINKEDIN','TWITTER')
            ) x WHERE (recent AND rn <= 6) OR (NOT recent AND rn <= 3)`
        : none<Top>(),
      ids.length
        ? prisma.$queryRaw<Fol[]>`
            SELECT DISTINCT ON ("clientId", platform) "clientId", platform::text AS platform, "followerCount" AS n
            FROM follower_snapshots WHERE "clientId" = ANY(${ids})
            ORDER BY "clientId", platform, "snapshotDateLocal" DESC`
        : none<Fol>(),
      ids.length
        ? prisma.$queryRaw<Fol[]>`
            SELECT DISTINCT ON ("clientId", platform) "clientId", platform::text AS platform, "followerCount" AS n
            FROM follower_snapshots WHERE "clientId" = ANY(${ids}) AND "snapshotDateLocal" <= ${f30Day}
            ORDER BY "clientId", platform, "snapshotDateLocal" DESC`
        : none<Fol>(),
      prisma.platformConnection.findMany({
        where: { clientId: { in: ids }, isEnabled: true, externalAccountUrl: { not: null } },
        select: { clientId: true, platform: true },
      }),
      getCollectionStatus(),
      orgId ? objectivesFor(orgId, clients).catch(() => null) : Promise.resolve(null),
    ]);

  const folThenM = new Map(folThen.map((f) => [`${f.clientId}|${f.platform}`, f.n]));

  const companies: DashCompany[] = clients.map((c) => {
    const nets = Array.from(
      new Set(conns.filter((x) => x.clientId === c.id && (x.platform as string) in PLAT_IDX).map((x) => x.platform as string)),
    );
    const mine = daily.filter((d) => d.clientId === c.id).map((d) => d.k);
    const lastRecent = mine.length ? mine.reduce((a, b) => (a > b ? a : b)) : null;
    const lastAny = monthly.some((m) => m.clientId === c.id) ? lastRecent ?? "older" : null;
    const firstMonth = monthly.filter((m) => m.clientId === c.id).map((m) => m.k).sort()[0];
    return {
      id: c.id,
      name: c.name,
      logoUrl: c.logoUrl,
      campaignStart: c.campaignStartDate ? isoDay(c.campaignStartDate) : firstMonth ? `${firstMonth}-01` : null,
      perWeek: obj ? obj.perWeek(c.id) : DEFAULT_PER_WEEK,
      networks: nets,
      lastPost: lastAny === "older" ? null : lastAny,
      followers: folNow
        .filter((f) => f.clientId === c.id && f.platform in PLAT_IDX)
        .map((f) => ({ platform: f.platform, now: f.n, then: folThenM.get(`${c.id}|${f.platform}`) ?? null })),
    };
  });

  const data: DashData = {
    companies,
    days: daily.map((d) => [idx.get(d.clientId)!, PLAT_IDX[d.platform], d.k, d.n, d.e, d.v]),
    cover: cover.map((r) => [idx.get(r.clientId)!, r.k, r.a, r.li, r.x]),
    months: monthly.map((d) => [idx.get(d.clientId)!, PLAT_IDX[d.platform], d.k, d.n, d.e, d.v]),
    top: top.map((t) => ({
      c: idx.get(t.clientId)!,
      platform: t.platform,
      date: t.d,
      url: t.url,
      text: t.t ?? "",
      likes: t.l,
      comments: t.c,
      shares: t.s,
      views: t.v,
    })),
    collection: collection.connections
      .filter((x) => idx.has(x.clientId) && x.platform in PLAT_IDX)
      .map((x) => ({ state: x.state, platform: x.platform, companyIdx: idx.get(x.clientId)!, lastSyncAt: x.lastSyncAt })),
    lastUpdate: collection.lastUpdate,
    today,
  };

  return <DashboardOverviewClient data={data} />;
}
