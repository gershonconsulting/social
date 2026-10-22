export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, Platform } from "@prisma/client";
import { sendCampaignMonthlyReport } from "@/lib/campaigns/send";
import { sendPostingAlert, dueAlerts } from "@/lib/alerts/send";
import { sendDailyReport } from "@/lib/reports/daily-report-send";
import { resolveFrom, resolveDigestTo } from "@/lib/email/sender";
import { splitDigestPosts } from "@/lib/reports/digest-window";
import { renderDigestHtml as renderHtml, digestSubject, type DigestData, type DigestBackfillRow } from "@/lib/reports/digest-render";

/**
 * GET  /api/digest/daily            — render the digest as JSON (preview).
 * POST /api/digest/daily            — render AND send via Resend.
 *
 * Daily digest content:
 *   - posts PUBLISHED in the last 24h, grouped by company (client) with
 *     per-platform breakdown. Posts ingested in the window but published
 *     earlier (back-fill) or with no readable publish date are listed in their
 *     own section and never counted as last 24h (2026-10-22 audit; rules in
 *     src/lib/reports/digest-window.ts, HTML in src/lib/reports/digest-render.ts)
 *   - compliance fresh-rate change vs the prior 24h
 *   - any sync errors in last 24h
 *   - coverage snapshot
 *
 * Auth (POST only): Bearer CRON_SECRET or DIGEST_SECRET.
 * Recipients: report@gershonconsulting.com + aina.rama@gershonconsulting.com
 *             (override with DIGEST_TO, comma-separated). See lib/email/sender.
 * Sender:     Social GershonCRM <social@gershon.ai> — the only VERIFIED Resend
 *             domain; anything else 403s for non-owner recipients.
 * Provider:  Resend — needs RESEND_API_KEY in env.
 */

async function buildDigest(): Promise<DigestData> {
  const now = new Date();
  const to = now;
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Posts ingested in the last 24h. A post published in the window was
  //    necessarily ingested in it too, so this one query covers both; the
  //    split by PUBLISH date happens right after.
  const ingested = await prisma.socialPost.findMany({
    where: { createdAt: { gte: from } },
    select: {
      id: true,
      clientId: true,
      createdAt: true,
      platform: true,
      postUrl: true,
      postTextSnippet: true,
      publishedAtUtc: true,
      likeCount: true,
      commentCount: true,
      shareCount: true,
    },
    orderBy: { publishedAtUtc: "desc" },
    take: 500,
  });
  const split = splitDigestPosts(ingested, { from, to });
  const recentPosts = split.window;

  // 2. Active clients (for name lookup)
  const clients = await prisma.client.findMany({
    where: { status: ClientStatus.ACTIVE },
    select: { id: true, name: true, slug: true, clientType: true },
  });
  const clientName = new Map<string, string>();
  for (const c of clients) clientName.set(c.id, c.name);
  const clientCategory = new Map<string, string>();
  for (const c of clients) clientCategory.set(c.id, c.clientType);

  // 3. Per-company aggregation + per-platform breakdown within each company
  const companyAgg = new Map<string, { newPosts: number; perPlatform: Map<string, number> }>();
  for (const p of recentPosts) {
    const slot = companyAgg.get(p.clientId) ?? { newPosts: 0, perPlatform: new Map<string, number>() };
    slot.newPosts++;
    slot.perPlatform.set(p.platform, (slot.perPlatform.get(p.platform) ?? 0) + 1);
    companyAgg.set(p.clientId, slot);
  }
  const CATEGORY_ORDER = ["CAMPAIGN", "CLIENT", "PARTNER", "PROSPECT", "INTERNAL", "COMPANY", "COMPETITION"];
  const catRank = (cat: string) => {
    const i = CATEGORY_ORDER.indexOf(cat);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  const perCompany = Array.from(companyAgg.entries()).map(([cid, slot]) => ({
    id: cid,
    name: clientName.get(cid) ?? cid,
    category: clientCategory.get(cid) ?? "CLIENT",
    newPosts: slot.newPosts,
    platforms: Array.from(slot.perPlatform.entries())
      .map(([platform, n]) => ({ platform, newPosts: n }))
      .sort((a, b) => b.newPosts - a.newPosts),
  })).sort((a, b) =>
    catRank(a.category) - catRank(b.category) ||
    b.newPosts - a.newPosts ||
    a.name.localeCompare(b.name)
  );
  const quietCompanies = clients.filter((c) => !companyAgg.has(c.id)).length;

  // 3b. Back-fill: collected now, published earlier or with no usable date.
  const bf = new Map<string, DigestBackfillRow>();
  const bfRow = (cid: string) => {
    const row = bf.get(cid) ?? { id: cid, name: clientName.get(cid) ?? cid, older: 0, unknown: 0, oldestPublishedAt: null };
    bf.set(cid, row);
    return row;
  };
  for (const p of split.older) {
    const row = bfRow(p.clientId);
    row.older++;
    const iso = p.publishedAtUtc.toISOString();
    if (!row.oldestPublishedAt || iso < row.oldestPublishedAt) row.oldestPublishedAt = iso;
  }
  for (const p of split.unknown) bfRow(p.clientId).unknown++;
  const backfill = Array.from(bf.values()).sort((a, b) => b.older + b.unknown - (a.older + a.unknown) || a.name.localeCompare(b.name));

  // 4. Top 5 posts by engagement (likes + comments + shares)
  const topPosts = [...recentPosts]
    .map((p) => ({
      clientName: clientName.get(p.clientId) ?? p.clientId,
      platform: p.platform,
      snippet: (p.postTextSnippet ?? "").slice(0, 140),
      postUrl: p.postUrl ?? "",
      engagement: (p.likeCount ?? 0) + (p.commentCount ?? 0) + (p.shareCount ?? 0),
      publishedAt: p.publishedAtUtc?.toISOString() ?? "",
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 5);

  // 5. Recent sync errors
  const errorConns = await prisma.platformConnection.findMany({
    where: { isEnabled: true, lastSyncError: { not: null }, lastSyncAt: { gte: from } },
    select: { clientId: true, platform: true, lastSyncError: true, lastSyncAt: true },
    take: 30,
  });
  const recentSyncErrors = errorConns.map((c) => ({
    clientName: clientName.get(c.clientId) ?? c.clientId,
    platform: c.platform,
    error: (c.lastSyncError ?? "").slice(0, 200),
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
  }));

  // 6. Coverage summary across the two platforms we collect
  const COVERAGE_PLATFORMS: Platform[] = [Platform.LINKEDIN, Platform.TWITTER];
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const [conns, anyPostKeys, recentKeys] = await Promise.all([
    prisma.platformConnection.findMany({
      where: {
        isEnabled: true,
        platform: { in: COVERAGE_PLATFORMS },
        client: { status: ClientStatus.ACTIVE },
      },
      select: { clientId: true, platform: true, externalAccountUrl: true },
    }),
    prisma.socialPost.groupBy({
      by: ["clientId", "platform"],
      _count: { _all: true },
    }),
    prisma.socialPost.groupBy({
      by: ["clientId", "platform"],
      where: { publishedAtUtc: { gte: fourteenDaysAgo } },
      _count: { _all: true },
    }),
  ]);
  const hasData = new Set(anyPostKeys.map((r) => `${r.clientId}:${r.platform}`));
  const hasRecent = new Set(recentKeys.filter((r) => (r._count._all ?? 0) > 0).map((r) => `${r.clientId}:${r.platform}`));
  const cov = { tier3: 0, tier2: 0, tier1: 0, tier0: 0, totalCells: 0 };
  for (const c of clients) {
    for (const plat of COVERAGE_PLATFORMS) {
      cov.totalCells++;
      const conn = conns.find((cc) => cc.clientId === c.id && cc.platform === plat);
      const k = `${c.id}:${plat}`;
      const hasLink = !!(conn?.externalAccountUrl);
      const dataPresent = hasData.has(k);
      const recentPresent = hasRecent.has(k);
      if (!hasLink) cov.tier0++;
      else if (!dataPresent) cov.tier1++;
      else if (!recentPresent) cov.tier2++;
      else cov.tier3++;
    }
  }

  return {
    generatedAt: now.toISOString(),
    window: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      newPosts: recentPosts.length,
      clientsWithActivity: new Set(recentPosts.map((p) => p.clientId)).size,
      collected: ingested.length,
      olderPosts: split.older.length,
      unknownDatePosts: split.unknown.length,
    },
    perCompany,
    quietCompanies,
    topPosts,
    backfill,
    recentSyncErrors,
    coverageSummary: cov,
  };
}

async function sendViaResend(html: string, subject: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set in environment" };
  const to = resolveDigestTo();
  const from = resolveFrom();
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, status: r.status, error: body.slice(0, 400) };
    }
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  try {
    const d = await buildDigest();
    const html = renderHtml(d);
    const url = new URL("https://example.com");
    // Allow ?format=html for preview in a browser
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    void url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "digest build failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Auth: Bearer CRON_SECRET or DIGEST_SECRET
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const d = await buildDigest();
    const html = renderHtml(d);
    const subject = digestSubject(d);
    const send = await sendViaResend(html, subject);

    // Month-end campaign report piggyback.
    //
    // The deploy PAT has no GitHub `workflow` scope, so a dedicated monthly
    // workflow file can't be pushed from a session (the health-check feature
    // is still waiting on exactly that manual step). This workflow already
    // runs every morning, so on the 1st we also fire the campaign monthly
    // report for the month that just closed. sendCampaignMonthlyReport is
    // idempotent — it records the month in settings.campaign_report_sent and
    // no-ops on every later call — so a retry, a manual dispatch, or a second
    // run on the same day cannot double-send.
    //
    // Wrapped so a failure here can never fail the daily digest: the digest
    // has already gone out by this point and the HTTP status must keep
    // reflecting the digest, not this.
    let campaignReport: unknown = null;
    try {
      const dayOfMonth = new Date().getUTCDate();
      const forced = new URL(req.url).searchParams.get("campaignReport") === "1";
      if (dayOfMonth === 1 || forced) {
        campaignReport = await sendCampaignMonthlyReport({});
      }
    } catch (e) {
      campaignReport = { error: e instanceof Error ? e.message : String(e) };
    }

    // Posting-alert fallback.
    //
    // The alert has its own workflow (posting-alert.yml, Fri 21:00 UTC and the
    // 1st) but that file has to be added by hand — the deploy PAT has no
    // GitHub `workflow` scope. Until it is installed, this daily run catches
    // the same two moments: the weekend digest sends the week alert, the 1st
    // sends the month alert. sendPostingAlert is idempotent on the period key,
    // so once the dedicated workflow exists this path simply no-ops.
    //
    // Wrapped so a failure can never fail the daily digest.
    let postingAlert: unknown = null;
    try {
      const forcedAlert = new URL(req.url).searchParams.get("postingAlert");
      const kinds = forcedAlert === "week" || forcedAlert === "month" ? [forcedAlert] : dueAlerts();
      if (kinds.length > 0) {
        const out = [];
        for (const kind of kinds) out.push(await sendPostingAlert({ kind: kind as "week" | "month" }));
        postingAlert = out.map((r) => ({ kind: r.kind, periodKey: r.periodKey, sent: r.sent, skipped: r.skipped }));
      }
    } catch (e) {
      postingAlert = { error: e instanceof Error ? e.message : String(e) };
    }

    // Daily progress-report fallback.
    //
    // The report has its own workflow (daily-report.yml, 12:00 UTC) but that
    // file has to be installed by hand — the deploy PAT has no GitHub
    // `workflow` scope. Until it exists, this run sends it an hour later
    // instead of not at all. sendDailyReport is idempotent on the ET day it
    // reports, so once the dedicated workflow is installed this path finds the
    // day already sent and no-ops.
    //
    // Wrapped so a failure here can never fail the digest, which has already
    // gone out by this point.
    let dailyReport: unknown = null;
    try {
      const forcedReport = new URL(req.url).searchParams.get("dailyReport") === "1";
      const r = await sendDailyReport({ force: forcedReport });
      dailyReport = { day: r.dayKey, sent: r.sent, skipped: r.skipped, to: r.to, error: r.error };
    } catch (e) {
      dailyReport = { error: e instanceof Error ? e.message : String(e) };
    }

    return NextResponse.json({
      success: send.ok,
      data: {
        digest: { subject, totals: d.totals, perCompany: d.perCompany.map((c) => ({ name: c.name, newPosts: c.newPosts })) },
        send,
        campaignReport,
        postingAlert,
        dailyReport,
      },
    }, { status: send.ok ? 200 : 502 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "digest send failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
