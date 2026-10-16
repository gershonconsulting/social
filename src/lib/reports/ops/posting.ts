/**
 * Report 2 — POSTING: did every campaign / internal company get its post?
 *
 * The truth is what actually appeared on the company's page, which the Chrome
 * extension collects every day (social_posts, by the post's own published
 * date). The Publishing tool's deliveries (scheduled_posts) are shown next to
 * it so a missed or failed publish is visible with its reason.
 *
 * Target per company = its posts-per-week objective (Settings → Campaign
 * objectives, default 5 = one post every working day; WALLIX 3).
 *   ≥ 7 / week → a post is expected every day
 *   ≥ 5 / week → every weekday
 *   < 5 / week → judged on the week only
 */
import prisma from "@/lib/db";
import { objectivesFor } from "@/lib/campaigns/objectives";
import { readHeartbeat } from "@/lib/extension/heartbeat";
import { PUBLISHING_CLIENT_TYPES } from "@/lib/publishing";
import { etDayKey, etDayShort, etMidnight } from "../et-days";
import {
  banner, esc, isWeekend, kpis, LEVEL_COLOR, page, pill, section, shortDay, SITE, table, TD, TDR, TH, THR,
  type Level,
} from "./shell";

const NET: Record<string, string> = { LINKEDIN: "LinkedIn", TWITTER: "X" };

export type PostingRow = {
  id: string;
  name: string;
  clientType: string;
  perWeek: number;
  /** Posts seen per day, oldest → yesterday. */
  days: Array<{ key: string; count: number; expected: boolean; nets: string[] }>;
  yesterday: { count: number; expected: boolean; ok: boolean | null };
  postsWeek: number;
  daysPosted: number;
  expectedDays: number;
  /** Publishing tool deliveries in the window. */
  published: number;
  missed: number;
  failed: number;
  lastError: string | null;
  lastPostKey: string | null;
  noConnection: boolean;
  level: Level;
};

export type PostingReport = {
  dayKey: string;
  dayShort: string;
  keys: string[];
  rows: PostingRow[];
  totals: { companies: number; postedYesterday: number; expectedYesterday: number; missedYesterday: number; onTarget: number; postsWeek: number };
  collection: { lastAt: string | null; stale: boolean };
  level: Level;
};

function expectedOn(key: string, perWeek: number): boolean {
  if (perWeek >= 7) return true;
  if (perWeek >= 5) return !isWeekend(key);
  return false;
}

export async function buildPostingReport(orgId: string, now = new Date()): Promise<PostingReport> {
  const keys = [7, 6, 5, 4, 3, 2, 1].map((d) => etDayKey(d, now));
  const dayKey = keys[keys.length - 1];

  const clients = await prisma.client.findMany({
    where: { organizationId: orgId, archivedAt: null, status: { not: "ARCHIVED" }, clientType: { in: PUBLISHING_CLIENT_TYPES } },
    select: { id: true, name: true, clientType: true, platformConnections: { select: { platform: true, isEnabled: true } } },
    orderBy: { name: "asc" },
  });
  const ids = clients.map((c) => c.id);
  const { perWeek } = await objectivesFor(orgId, clients);

  const [posts, deliveries, lastPosts, hb] = await Promise.all([
    ids.length
      ? prisma.socialPost.findMany({
          where: { clientId: { in: ids }, publishedDateLocal: { in: keys } },
          select: { clientId: true, platform: true, publishedDateLocal: true },
        })
      : Promise.resolve([]),
    prisma.scheduledPost.findMany({
      where: { organizationId: orgId, scheduledAt: { gte: etMidnight(7, now), lt: etMidnight(0, now) } },
      select: { clientId: true, status: true, lastError: true, scheduledAt: true },
      orderBy: { scheduledAt: "asc" },
    }),
    ids.length
      ? prisma.$queryRaw<Array<{ clientId: string; publishedDateLocal: string }>>`
          SELECT "clientId", MAX("publishedDateLocal") AS "publishedDateLocal"
          FROM social_posts WHERE "clientId" = ANY(${ids}) GROUP BY "clientId"`
      : Promise.resolve([] as Array<{ clientId: string; publishedDateLocal: string }>),
    readHeartbeat(),
  ]);

  const lastPostBy = new Map(lastPosts.map((p) => [p.clientId, p.publishedDateLocal]));

  const rows: PostingRow[] = clients.map((c) => {
    const pw = perWeek(c.id);
    const mine = posts.filter((p) => p.clientId === c.id);
    const days = keys.map((key) => {
      const onDay = mine.filter((p) => p.publishedDateLocal === key);
      return { key, count: onDay.length, expected: expectedOn(key, pw), nets: Array.from(new Set(onDay.map((p) => NET[p.platform] || p.platform))) };
    });
    const y = days[days.length - 1];
    const daysPosted = days.filter((d) => d.count > 0).length;
    const expectedDays = Math.min(7, Math.round(pw));
    const dl = deliveries.filter((d) => d.clientId === c.id);
    const missed = dl.filter((d) => d.status === "MISSED").length;
    const failed = dl.filter((d) => d.status === "FAILED").length;
    const lastErr = [...dl].reverse().find((d) => d.lastError && (d.status === "MISSED" || d.status === "FAILED"));
    const yOk = y.expected ? y.count > 0 : y.count > 0 ? true : null;
    const behindWeek = daysPosted < expectedDays;
    const level: Level =
      (y.expected && y.count === 0) || daysPosted === 0 ? "critical" : behindWeek || missed + failed > 0 ? "warn" : "ok";
    return {
      id: c.id,
      name: c.name,
      clientType: c.clientType,
      perWeek: pw,
      days,
      yesterday: { count: y.count, expected: y.expected, ok: yOk },
      postsWeek: mine.length,
      daysPosted,
      expectedDays,
      published: dl.filter((d) => d.status === "POSTED").length,
      missed,
      failed,
      lastError: lastErr?.lastError ?? null,
      lastPostKey: lastPostBy.get(c.id) ?? null,
      noConnection: !c.platformConnections.some((p) => p.isEnabled && (p.platform === "LINKEDIN" || p.platform === "TWITTER")),
      level,
    };
  });

  const rank = { critical: 0, warn: 1, ok: 2 } as const;
  rows.sort((a, b) => rank[a.level] - rank[b.level] || a.daysPosted - b.daysPosted || a.name.localeCompare(b.name));

  const expectedY = rows.filter((r) => r.yesterday.expected);
  const lastAt = hb.lastAt;
  const stale = !lastAt || Date.now() - Date.parse(lastAt) > 30 * 3600000;
  const totals = {
    companies: rows.length,
    postedYesterday: rows.filter((r) => r.yesterday.count > 0).length,
    expectedYesterday: expectedY.length,
    missedYesterday: expectedY.filter((r) => r.yesterday.count === 0).length,
    onTarget: rows.filter((r) => r.daysPosted >= r.expectedDays).length,
    postsWeek: rows.reduce((s, r) => s + r.postsWeek, 0),
  };
  const level: Level = totals.missedYesterday > 0 ? "critical" : rows.some((r) => r.level !== "ok") ? "warn" : "ok";
  return { dayKey, dayShort: etDayShort(1, now), keys, rows, totals, collection: { lastAt, stale }, level };
}

function dayCell(d: PostingRow["days"][number]): string {
  if (d.count > 0) {
    return `<td style="padding:6px 4px;text-align:center;border-bottom:1px solid #f1f1f1;"><span title="${esc(d.nets.join(" + "))}" style="display:inline-block;min-width:22px;padding:3px 0;border-radius:4px;background:${LEVEL_COLOR.ok};color:#fff;font-size:12px;font-weight:700;">${d.count}</span></td>`;
  }
  if (d.expected) {
    return `<td style="padding:6px 4px;text-align:center;border-bottom:1px solid #f1f1f1;"><span style="display:inline-block;min-width:22px;padding:3px 0;border-radius:4px;background:#fee2e2;color:${LEVEL_COLOR.critical};font-size:12px;font-weight:700;">✕</span></td>`;
  }
  return `<td style="padding:6px 4px;text-align:center;border-bottom:1px solid #f1f1f1;color:#d1d5db;font-size:12px;">·</td>`;
}

export function renderPosting(r: PostingReport): string {
  const t = r.totals;
  const head = banner(
    r.level,
    t.missedYesterday
      ? `${t.missedYesterday} of ${t.expectedYesterday} companies did NOT post on ${r.dayShort}`
      : t.expectedYesterday
        ? `All ${t.expectedYesterday} companies due on ${r.dayShort} posted`
        : `${r.dayShort} was not a posting day — ${t.postedYesterday} companies posted anyway`,
    `${t.onTarget} of ${t.companies} companies are on their weekly target over the last 7 days.` +
      (r.collection.stale
        ? ` <b>Careful:</b> the Chrome extension has not collected since ${r.collection.lastAt ? esc(new Date(r.collection.lastAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })) + " ET" : "— never"}, so posts made since then are not seen yet.`
        : ""),
  );

  const grid = table(
    `<tr><th ${TH}>Company</th>${r.keys.map((k) => `<th style="padding:7px 4px;text-align:center;font-size:11px;color:#6b7280;font-weight:700;border-bottom:2px solid #eee;white-space:nowrap;">${shortDay(k)}</th>`).join("")}<th ${THR}>Week</th></tr>`,
    r.rows
      .map(
        (row) => `<tr>
      <td ${TD}><a href="${SITE}/clients/${row.id}" style="color:#111;font-weight:700;text-decoration:none;">${esc(row.name)}</a>
        <div style="font-size:11px;color:#9ca3af;">${row.clientType === "INTERNAL" ? "Internal" : "Campaign"} · target ${row.perWeek}/week</div></td>
      ${row.days.map(dayCell).join("")}
      <td ${TDR}>${pill(`${row.daysPosted}/${row.expectedDays} days`, row.level)}</td>
    </tr>`,
      )
      .join(""),
  );

  const problems = r.rows.filter((x) => x.level !== "ok");
  const why = problems.length
    ? table(
        `<tr><th ${TH}>Company</th><th ${TH}>What is wrong</th></tr>`,
        problems
          .map((x) => {
            const notes: string[] = [];
            if (x.noConnection) notes.push("No LinkedIn / X page connected — nothing can be seen or published.");
            if (x.yesterday.expected && x.yesterday.count === 0) notes.push(`No post on ${esc(r.dayShort)}.`);
            if (x.daysPosted < x.expectedDays) notes.push(`Posted on ${x.daysPosted} of the ${x.expectedDays} days expected this week.`);
            if (x.missed) notes.push(`${x.missed} scheduled post${x.missed === 1 ? "" : "s"} MISSED by the publishing browser.`);
            if (x.failed) notes.push(`${x.failed} scheduled post${x.failed === 1 ? "" : "s"} FAILED.`);
            if (x.lastError) notes.push(`<span style="color:#6b7280;">Last error: ${esc(x.lastError.slice(0, 160))}</span>`);
            if (x.lastPostKey) notes.push(`<span style="color:#6b7280;">Last post seen: ${esc(x.lastPostKey)}</span>`);
            return `<tr><td ${TD}><b>${esc(x.name)}</b></td><td ${TD}>${notes.join("<br>")}</td></tr>`;
          })
          .join(""),
      )
    : `<div style="font-size:14px;color:${LEVEL_COLOR.ok};font-weight:700;">Nothing to fix — every company is on target.</div>`;

  const body =
    head +
    kpis([
      { label: `Posted ${r.dayShort.replace(/, \d{4}$/, "")}`, value: `${t.postedYesterday}/${t.companies}`, level: t.missedYesterday ? "critical" : "ok" },
      { label: "Missed (due)", value: String(t.missedYesterday), level: t.missedYesterday ? "critical" : "ok" },
      { label: "On weekly target", value: `${t.onTarget}/${t.companies}`, level: t.onTarget === t.companies ? "ok" : "warn" },
      { label: "Posts, last 7 days", value: String(t.postsWeek) },
    ]) +
    section(
      "Last 7 days, company by company",
      grid,
      "Number = posts seen on the company's LinkedIn / X page that day · <span style=\"color:#b91c1c;font-weight:700;\">✕</span> = a post was due and none appeared · · = not a posting day.",
    ) +
    section("What needs fixing", why);

  return page({
    kind: "posting",
    title: "Social Posting Report",
    subtitle: `Did we post for every company? — ${r.dayShort} and the 7 days to it`,
    body,
    cta: { href: `${SITE}/publishing`, label: "Open Publishing" },
  });
}

export function postingSubject(r: PostingReport): string {
  const t = r.totals;
  const base = `Social Posting Report — ${r.dayShort}`;
  if (t.missedYesterday) return `⛔ ${base} — ${t.missedYesterday} ${t.missedYesterday === 1 ? "company" : "companies"} did not post`;
  return `${base} — ${t.postedYesterday}/${t.companies} posted, ${t.onTarget}/${t.companies} on weekly target`;
}
