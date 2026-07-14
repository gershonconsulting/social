export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType, ComplianceStatus } from "@prisma/client";

/**
 * GET /api/campaigns/attainment
 *
 * "% posted" for our current campaigns, over four windows:
 *   thisWeek, lastWeek, thisMonth, lastMonth
 *
 * Definition (same source of truth as the dashboard):
 *   pct = expected posting days that were MET (DailyCompliance.status = GREEN)
 *         ÷ expected posting days (DailyCompliance.expectedFlag = true)
 * So 100% = every scheduled post actually went out.
 *
 * Scope: clients with clientType = CAMPAIGN, not ARCHIVED.
 *
 * Returns overall totals plus a per-campaign breakdown, so a consumer can
 * show one company's number or the whole book.
 *
 * Auth: X-API-Key header, matched against CAMPAIGN_API_KEY (falls back to
 * TEST_API_KEY so it works with the key that already exists).
 *
 * Consumed by client.gershoncrm.com (PROMOTE → LinkedIn). Keep the key
 * server-side — never fetch this straight from a browser.
 *
 * Weeks are Monday-start to match the client app's weekly report.
 */

const TZ = process.env.DEFAULT_TIMEZONE || "America/New_York";

/** YYYY-MM-DD for a Date in the reporting timezone. */
function ymd(d: Date): string {
  // en-CA gives ISO-like YYYY-MM-DD
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** "Now" as a date in the reporting timezone, at local midnight. */
function todayInTz(): Date {
  const s = ymd(new Date());
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

type Window = { key: string; start: string; end: string; label: string };

function buildWindows(): Window[] {
  const today = todayInTz();
  const dow = today.getUTCDay(); // 0=Sun
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const thisMonday = addDays(today, -mondayOffset);
  const lastMonday = addDays(thisMonday, -7);
  const lastSunday = addDays(thisMonday, -1);

  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const thisMonthStart = new Date(Date.UTC(y, m, 1));
  const lastMonthStart = new Date(Date.UTC(y, m - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(y, m, 0)); // day 0 = last day of prev month

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return [
    { key: "thisWeek",  start: ymdUTC(thisMonday),     end: ymdUTC(today),        label: `${fmt(thisMonday)} — ${fmt(today)}` },
    { key: "lastWeek",  start: ymdUTC(lastMonday),     end: ymdUTC(lastSunday),   label: `${fmt(lastMonday)} — ${fmt(lastSunday)}` },
    { key: "thisMonth", start: ymdUTC(thisMonthStart), end: ymdUTC(today),        label: today.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) },
    { key: "lastMonth", start: ymdUTC(lastMonthStart), end: ymdUTC(lastMonthEnd), label: lastMonthStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) },
  ];
}

/** YYYY-MM-DD from a UTC-midnight Date (already normalized to the TZ day). */
function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Bucket = { expected: number; met: number; pct: number | null; label: string };

function emptyBuckets(windows: Window[]): Record<string, Bucket> {
  const o: Record<string, Bucket> = {};
  for (const w of windows) o[w.key] = { expected: 0, met: 0, pct: null, label: w.label };
  return o;
}

function finalize(b: Record<string, Bucket>) {
  for (const k of Object.keys(b)) {
    const v = b[k];
    // pct stays null when nothing was expected — 0% would be a lie.
    v.pct = v.expected > 0 ? Math.round((v.met / v.expected) * 1000) / 10 : null;
  }
}

export async function GET(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = process.env.CAMPAIGN_API_KEY || process.env.TEST_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { success: false, error: "CAMPAIGN_API_KEY not configured on this environment" },
      { status: 503 },
    );
  }
  if (!provided || provided !== expected) {
    return NextResponse.json({ success: false, error: "Invalid or missing X-API-Key" }, { status: 401 });
  }

  try {
    const windows = buildWindows();
    const rangeStart = windows.reduce((min, w) => (w.start < min ? w.start : min), windows[0].start);
    const rangeEnd = windows.reduce((max, w) => (w.end > max ? w.end : max), windows[0].end);

    const rows = await prisma.dailyCompliance.findMany({
      where: {
        expectedFlag: true,
        dateLocal: { gte: rangeStart, lte: rangeEnd },
        client: {
          clientType: ClientType.CAMPAIGN,
          status: { not: ClientStatus.ARCHIVED },
        },
      },
      select: {
        dateLocal: true,
        status: true,
        clientId: true,
        client: { select: { id: true, name: true, slug: true } },
      },
    });

    const totals = emptyBuckets(windows);
    const perCampaign = new Map<string, { id: string; name: string; slug: string; periods: Record<string, Bucket> }>();

    for (const r of rows) {
      const met = r.status === ComplianceStatus.GREEN;
      let c = perCampaign.get(r.clientId);
      if (!c) {
        c = { id: r.client.id, name: r.client.name, slug: r.client.slug, periods: emptyBuckets(windows) };
        perCampaign.set(r.clientId, c);
      }
      for (const w of windows) {
        if (r.dateLocal >= w.start && r.dateLocal <= w.end) {
          totals[w.key].expected++;
          c.periods[w.key].expected++;
          if (met) {
            totals[w.key].met++;
            c.periods[w.key].met++;
          }
        }
      }
    }

    finalize(totals);
    const campaigns = [...perCampaign.values()].map((c) => {
      finalize(c.periods);
      return c;
    }).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        timezone: TZ,
        basis: "expected posting days met / expected posting days (DailyCompliance)",
        scope: "clientType=CAMPAIGN, not archived",
        periods: totals,
        campaigns,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "attainment failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
