/**
 * Daily progress report — "what happened yesterday, and did we move forward?"
 *
 * A platform feature, not a person's morning routine: the app builds it, the
 * app sends it. Three jobs, in priority order:
 *
 *   1. RUN STATUS — a loud, unmissable banner when the collection system did
 *      not do its daily job. "No new posts" and "the collector never ran" are
 *      indistinguishable in social_posts, so the ingest heartbeat
 *      (settings.collection_heartbeat) is what separates a quiet day from a
 *      dead pipeline.
 *   2. PROGRESS — every headline number for yesterday next to the day before
 *      and the trailing 7-day average, so "did we make progress" has an
 *      arithmetic answer instead of a feeling.
 *   3. EXTENSION — a warning when a superseded Chrome-extension build is still
 *      the one installed, with BOTH upgrade paths spelled out.
 *
 * Day boundaries are America/New_York calendar days (see ./et-days), because
 * "yesterday" means yesterday as the business lived it.
 *
 * Recipient follows the platform-report-email convention: every platform
 * report goes to report@gershonconsulting.com with the platform name and the
 * date range in the subject.
 */

import prisma from "@/lib/db";
import { EXTENSION_LATEST } from "@/lib/extension-version";
import { readExtSeen, semverLt, type ExtSeen } from "@/lib/extension/seen";
import { readHeartbeat } from "@/lib/extension/heartbeat";
import { etDayKey, etDayLabel, etDayShort, etMidnight } from "./et-days";

export const REPORT_SENT_KEY = "daily_report_sent";
export const DEFAULT_REPORT_TO = "report@gershonconsulting.com";
const SITE = "https://social.gershoncrm.com";


/** Where a `Load unpacked` copy of the extension lives on Olivier's machine. */
const LOCAL_EXT_PATH =
  "C:\\Users\\oatti\\Documents\\Claude\\Projects\\Social Gershon Consulting\\watchman-chrome-extension";

type Level = "ok" | "warn" | "critical";

export interface Metric {
  key: string;
  label: string;
  hint: string;
  yesterday: number | null;
  dayBefore: number | null;
  avg7: number | null;
  higherIsBetter: boolean;
}

export interface DailyReport {
  generatedAt: string;
  day: { key: string; label: string; short: string };
  status: {
    level: Level;
    headline: string;
    detail: string;
    ranYesterday: boolean | null;
    runsYesterday: number | null;
    lastIngestAt: string | null;
  };
  progress: {
    level: Level;
    headline: string;
    improved: number;
    declined: number;
    flat: number;
  };
  metrics: Metric[];
  extension: {
    level: Level;
    headline: string;
    detail: string;
    installed: string | null;
    latest: string;
    lastSeenAt: string | null;
    downloadUrl: string;
    localPath: string;
  };
  movers: { name: string; id: string; category: string; yesterday: number; dayBefore: number }[];
  wentQuiet: { name: string; id: string; dayBefore: number }[];
  errors: { clientName: string; platform: string; error: string; lastSyncAt: string | null }[];
  activeCompanies: number;
}

interface DayRow {
  day: string;
  posts: number;
  companies: number;
  engagement: number;
  linkedin: number;
  twitter: number;
}

/** Per-ET-day collection stats for the last `days` days (today excluded). */
async function collectionByDay(now: Date, days: number): Promise<Map<string, DayRow>> {
  const from = etMidnight(days, now);
  const to = etMidnight(0, now);
  const rows = await prisma.$queryRaw<Array<{
    day: string;
    posts: number;
    companies: number;
    engagement: number;
    linkedin: number;
    twitter: number;
  }>>`
    SELECT to_char(("createdAt" AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS day,
           count(*)::int AS posts,
           count(DISTINCT "clientId")::int AS companies,
           coalesce(sum("likeCount" + "commentCount" + "shareCount"), 0)::int AS engagement,
           count(*) FILTER (WHERE platform::text = 'LINKEDIN')::int AS linkedin,
           count(*) FILTER (WHERE platform::text = 'TWITTER')::int AS twitter
      FROM social_posts
     WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
     GROUP BY 1
  `;
  const map = new Map<string, DayRow>();
  for (const r of rows) {
    map.set(r.day, {
      day: r.day,
      posts: Number(r.posts),
      companies: Number(r.companies),
      engagement: Number(r.engagement),
      linkedin: Number(r.linkedin),
      twitter: Number(r.twitter),
    });
  }
  return map;
}

/** Companies added per ET day. */
async function companiesAddedByDay(now: Date, days: number): Promise<Map<string, number>> {
  const from = etMidnight(days, now);
  const to = etMidnight(0, now);
  const rows = await prisma.$queryRaw<Array<{ day: string; added: number }>>`
    SELECT to_char(("createdAt" AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS day,
           count(*)::int AS added
      FROM clients
     WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
     GROUP BY 1
  `;
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.day, Number(r.added));
  return map;
}

/**
 * How many ACTIVE companies had published something in the 14 days before
 * `boundary` — the freshness/coverage measure, evaluated at a point in time so
 * it can be compared day over day.
 */
async function freshCompaniesAt(boundary: Date): Promise<number> {
  const windowStart = new Date(boundary.getTime() - 14 * 86400000);
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(DISTINCT p."clientId")::int AS n
      FROM social_posts p
      JOIN clients c ON c.id = p."clientId"
     WHERE c.status::text = 'ACTIVE'
       AND p."publishedAtUtc" >= ${windowStart}
       AND p."publishedAtUtc" < ${boundary}
  `;
  return Number(rows[0]?.n ?? 0);
}

/** Per-company post counts for one ET day. */
async function perCompany(from: Date, to: Date) {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string; category: string; n: number }>>`
    SELECT c.id AS id, c.name AS name, c."clientType"::text AS category, count(*)::int AS n
      FROM social_posts p
      JOIN clients c ON c.id = p."clientId"
     WHERE p."createdAt" >= ${from} AND p."createdAt" < ${to}
     GROUP BY 1, 2, 3
  `;
  return rows.map((r) => ({ id: r.id, name: r.name, category: r.category, n: Number(r.n) }));
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export async function buildDailyReport(now: Date = new Date()): Promise<DailyReport> {
  const yKey = etDayKey(1, now);
  const dKey = etDayKey(2, now);
  const weekKeys = [1, 2, 3, 4, 5, 6, 7].map((i) => etDayKey(i, now));

  const yFrom = etMidnight(1, now);
  const yTo = etMidnight(0, now);
  const dFrom = etMidnight(2, now);

  const [byDay, added, hb, extSeen, activeCompanies, freshY, freshD, compY, compD, errConns] =
    await Promise.all([
      collectionByDay(now, 8),
      companiesAddedByDay(now, 8),
      readHeartbeat(),
      readExtSeen(),
      prisma.client.count({ where: { status: "ACTIVE" } }),
      freshCompaniesAt(yTo),
      freshCompaniesAt(yFrom),
      perCompany(yFrom, yTo),
      perCompany(dFrom, yFrom),
      prisma.platformConnection.findMany({
        where: { isEnabled: true, lastSyncError: { not: null } },
        select: {
          platform: true,
          lastSyncError: true,
          lastSyncAt: true,
          client: { select: { name: true, status: true } },
        },
        orderBy: { lastSyncAt: "desc" },
        take: 15,
      }),
    ]);

  const dayRow = (k: string): DayRow =>
    byDay.get(k) ?? { day: k, posts: 0, companies: 0, engagement: 0, linkedin: 0, twitter: 0 };

  const y = dayRow(yKey);
  const d = dayRow(dKey);
  const week = weekKeys.map(dayRow);

  // Failed collection attempts come from the heartbeat, which is the only
  // place with real per-day history (lastSyncError is current state only).
  const hbDay = (k: string) => hb.days[k];
  const failedFor = (k: string): number | null => {
    const e = hbDay(k);
    return e ? e.failed : null;
  };
  const weekFailed = weekKeys.map(failedFor).filter((v): v is number => v !== null);

  const metrics: Metric[] = [
    {
      key: "posts",
      label: "Posts collected",
      hint: `${y.linkedin} LinkedIn · ${y.twitter} X`,
      yesterday: y.posts,
      dayBefore: d.posts,
      avg7: avg(week.map((w) => w.posts)),
      higherIsBetter: true,
    },
    {
      key: "companies",
      label: "Companies with new content",
      hint: `of ${activeCompanies} active companies`,
      yesterday: y.companies,
      dayBefore: d.companies,
      avg7: avg(week.map((w) => w.companies)),
      higherIsBetter: true,
    },
    {
      key: "fresh",
      label: "Companies fresh (posted in 14d)",
      hint: activeCompanies > 0 ? `${Math.round((freshY / activeCompanies) * 100)}% coverage` : "",
      yesterday: freshY,
      dayBefore: freshD,
      avg7: null,
      higherIsBetter: true,
    },
    {
      key: "engagement",
      label: "Engagement collected",
      hint: "likes + comments + shares on new posts",
      yesterday: y.engagement,
      dayBefore: d.engagement,
      avg7: avg(week.map((w) => w.engagement)),
      higherIsBetter: true,
    },
    {
      key: "failed",
      label: "Failed collection attempts",
      hint: "per-company scrape failures reported by the extension",
      yesterday: failedFor(yKey),
      dayBefore: failedFor(dKey),
      avg7: avg(weekFailed),
      higherIsBetter: false,
    },
    {
      key: "added",
      label: "Companies added",
      hint: "new companies now being tracked",
      yesterday: added.get(yKey) ?? 0,
      dayBefore: added.get(dKey) ?? 0,
      avg7: avg(weekKeys.map((k) => added.get(k) ?? 0)),
      higherIsBetter: true,
    },
  ];

  // ── Run status ────────────────────────────────────────────────────────────
  const hbY = hbDay(yKey);
  const ranYesterday = hbY ? hbY.runs > 0 : null; // null = heartbeat has no record for that day
  const avgPosts = avg(week.map((w) => w.posts)) ?? 0;

  let status: DailyReport["status"];
  if (y.posts === 0 && ranYesterday !== true) {
    status = {
      level: "critical",
      headline: "THE SYSTEM DID NOT DO ITS DAILY JOB",
      detail:
        "No collection run reached the server yesterday and no posts were ingested. Nothing was captured from LinkedIn or X. Open Chrome with the GershonAI extension installed and run a full sync from the dashboard.",
      ranYesterday,
      runsYesterday: hbY?.runs ?? null,
      lastIngestAt: hb.lastAt,
    };
  } else if (y.posts === 0) {
    status = {
      level: "critical",
      headline: "COLLECTION RAN BUT BROUGHT BACK NOTHING",
      detail: `The collector reported in ${hbY?.runs ?? 0} time(s) yesterday but not a single post was stored. That is almost always an expired LinkedIn or X session — re-login in Chrome, then run a sync.`,
      ranYesterday,
      runsYesterday: hbY?.runs ?? null,
      lastIngestAt: hb.lastAt,
    };
  } else if (avgPosts >= 20 && y.posts < avgPosts * 0.4) {
    status = {
      level: "warn",
      headline: "COLLECTION RAN SHORT",
      detail: `${y.posts} posts is well under the 7-day average of ${Math.round(avgPosts)}. One platform probably failed — check the errors below before assuming a quiet day.`,
      ranYesterday,
      runsYesterday: hbY?.runs ?? null,
      lastIngestAt: hb.lastAt,
    };
  } else {
    status = {
      level: "ok",
      headline: "Collection ran",
      detail: `${y.posts} posts captured from ${y.companies} ${y.companies === 1 ? "company" : "companies"}.`,
      ranYesterday,
      runsYesterday: hbY?.runs ?? null,
      lastIngestAt: hb.lastAt,
    };
  }

  // ── Progress verdict ──────────────────────────────────────────────────────
  let improved = 0;
  let declined = 0;
  let flat = 0;
  for (const m of metrics) {
    if (m.yesterday === null || m.dayBefore === null) continue;
    const delta = m.yesterday - m.dayBefore;
    if (delta === 0) flat++;
    else if (delta > 0 === m.higherIsBetter) improved++;
    else declined++;
  }
  const progress: DailyReport["progress"] = {
    level: improved > declined ? "ok" : declined > improved ? "warn" : "ok",
    headline:
      improved > declined
        ? "Progress — more moved forward than back"
        : declined > improved
          ? "Regression — more moved back than forward"
          : "Flat — no net movement",
    improved,
    declined,
    flat,
  };

  // ── Extension version ─────────────────────────────────────────────────────
  const extension = buildExtensionBlock(extSeen, now);

  // ── Movers / went quiet ───────────────────────────────────────────────────
  const dMap = new Map(compD.map((c) => [c.id, c.n]));
  const yMap = new Map(compY.map((c) => [c.id, c.n]));
  const movers = compY
    .map((c) => ({ name: c.name, id: c.id, category: c.category, yesterday: c.n, dayBefore: dMap.get(c.id) ?? 0 }))
    .sort((a, b) => b.yesterday - a.yesterday || a.name.localeCompare(b.name))
    .slice(0, 12);
  const wentQuiet = compD
    .filter((c) => !yMap.has(c.id))
    .map((c) => ({ name: c.name, id: c.id, dayBefore: c.n }))
    .sort((a, b) => b.dayBefore - a.dayBefore)
    .slice(0, 8);

  const errors = errConns
    .filter((c) => c.client?.status === "ACTIVE")
    .map((c) => ({
      clientName: c.client?.name ?? "Unknown",
      platform: c.platform as string,
      error: (c.lastSyncError ?? "").slice(0, 180),
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    }))
    .slice(0, 10);

  return {
    generatedAt: now.toISOString(),
    day: { key: yKey, label: etDayLabel(1, now), short: etDayShort(1, now) },
    status,
    progress,
    metrics,
    extension,
    movers,
    wentQuiet,
    errors,
    activeCompanies,
  };
}

function buildExtensionBlock(seen: ExtSeen | null, now: Date): DailyReport["extension"] {
  const base = {
    latest: EXTENSION_LATEST,
    downloadUrl: `${SITE}/gershonai-extension.zip`,
    localPath: LOCAL_EXT_PATH,
  };
  if (!seen) {
    return {
      ...base,
      level: "warn",
      headline: "Extension version unknown",
      detail:
        "No GershonAI extension has reported in yet. Either it is not installed in the Chrome you use for collection, or you have not opened social.gershoncrm.com in that browser since this check went live. Open the dashboard there once and this resolves itself.",
      installed: null,
      lastSeenAt: null,
    };
  }
  const stale = semverLt(seen.version, EXTENSION_LATEST);
  const ageDays = Math.floor((now.getTime() - new Date(seen.lastSeenAt).getTime()) / 86400000);
  if (stale) {
    return {
      ...base,
      level: "critical",
      headline: `Chrome extension is out of date — v${seen.version} installed, v${EXTENSION_LATEST} available`,
      detail: `The old build is still the one running collection. Upgrade it today — a superseded extension is the most common cause of silent scrape failures.`,
      installed: seen.version,
      lastSeenAt: seen.lastSeenAt,
    };
  }
  if (ageDays >= 3) {
    return {
      ...base,
      level: "warn",
      headline: `Extension not seen for ${ageDays} days`,
      detail: `v${seen.version} is current, but nothing has reported in since ${new Date(seen.lastSeenAt).toLocaleDateString("en-US", { dateStyle: "medium" })}. If collection is still landing, this is only a quiet dashboard; if it is not, the extension may have been removed or disabled.`,
      installed: seen.version,
      lastSeenAt: seen.lastSeenAt,
    };
  }
  return {
    ...base,
    level: "ok",
    headline: `Chrome extension up to date (v${seen.version})`,
    detail: "",
    installed: seen.version,
    lastSeenAt: seen.lastSeenAt,
  };
}
