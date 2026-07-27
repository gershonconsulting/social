export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, Platform } from "@prisma/client";

/**
 * GET  /api/digest/daily            — render the digest as JSON (preview).
 * POST /api/digest/daily            — render AND send via Resend.
 *
 * Daily digest content:
 *   - new posts in last 24h, grouped by company (client) with per-platform breakdown
 *   - compliance fresh-rate change vs the prior 24h
 *   - any sync errors in last 24h
 *   - coverage snapshot
 *
 * Auth (POST only): Bearer CRON_SECRET or DIGEST_SECRET.
 * Recipient: process.env.DIGEST_TO (defaults to oattia@gmail.com).
 * Sender:    process.env.DIGEST_FROM (defaults to digest@notifications.gershoncrm.com,
 *            falls back to onboarding@resend.dev if RESEND_DOMAIN_VERIFIED isn't set).
 * Provider:  Resend — needs RESEND_API_KEY in env.
 */

interface DigestData {
  generatedAt: string;
  window: { from: string; to: string };
  totals: { newPosts: number; clientsWithActivity: number };
  perCompany: Array<{ id: string; name: string; category: string; newPosts: number; platforms: Array<{ platform: string; newPosts: number }> }>;
  quietCompanies: number;
  topPosts: Array<{ clientName: string; platform: string; snippet: string; postUrl: string; engagement: number; publishedAt: string }>;
  recentSyncErrors: Array<{ clientName: string; platform: string; error: string; lastSyncAt: string | null }>;
  coverageSummary: { tier3: number; tier2: number; tier1: number; tier0: number; totalCells: number };
}

async function buildDigest(): Promise<DigestData> {
  const now = new Date();
  const to = now;
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // 1. Posts created/ingested in the last 24h
  const recentPosts = await prisma.socialPost.findMany({
    where: { createdAt: { gte: from } },
    select: {
      id: true,
      clientId: true,
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

  // 6. Coverage summary across the 3 main platforms
  const COVERAGE_PLATFORMS: Platform[] = [Platform.LINKEDIN, Platform.TWITTER, Platform.GOOGLE_BUSINESS];
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
    },
    perCompany,
    quietCompanies,
    topPosts,
    recentSyncErrors,
    coverageSummary: cov,
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
};

const CATEGORY_LABELS: Record<string, string> = {
  CAMPAIGN: "Campaign",
  CLIENT: "Client",
  PARTNER: "Partner",
  PROSPECT: "Prospect",
  INTERNAL: "Internal",
  COMPANY: "Company",
  COMPETITION: "Competition",
};

function renderHtml(d: DigestData): string {
  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };
  const day = new Date(d.generatedAt).toLocaleDateString("en-US", { dateStyle: "full" });

  let lastCategory = "";
  const companyRows = d.perCompany.map((c) => {
    const catTotal = d.perCompany.filter((x) => x.category === c.category).reduce((s, x) => s + x.newPosts, 0);
    const header = c.category !== lastCategory ? `
    <tr>
      <td colspan="3" style="padding:10px 12px 6px;background:${c.category === "CAMPAIGN" ? "#fff8f7" : "#f9fafb"};border-bottom:1px solid #e5e7eb;">
        <span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${c.category === "CAMPAIGN" ? "#FE1B04" : "#374151"};">${CATEGORY_LABELS[c.category] ?? c.category}</span>
        <span style="font-size:11px;color:#9ca3af;margin-left:8px;">${catTotal} ${catTotal === 1 ? "post" : "posts"}</span>
      </td>
    </tr>` : "";
    lastCategory = c.category;
    return `${header}
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">
        <a href="https://social.gershoncrm.com/clients/${c.id}" style="color:#111;text-decoration:none;">${c.name}</a>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:700;font-size:18px;">${c.newPosts}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:#555;">
        ${c.platforms.map((p) => `${PLATFORM_LABELS[p.platform] ?? p.platform} (${p.newPosts})`).join(" · ")}
      </td>
    </tr>`;
  }).join("");

  const topPostRows = d.topPosts.map((p) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;vertical-align:top;">
        <div style="font-weight:600;font-size:13px;">${p.clientName} <span style="color:#999;font-weight:400;">· ${PLATFORM_LABELS[p.platform] ?? p.platform}</span></div>
        <div style="font-size:13px;color:#444;margin-top:4px;">${p.snippet.replace(/</g, "&lt;")}</div>
        <div style="font-size:11px;color:#999;margin-top:6px;">${fmtDate(p.publishedAt)} · ${p.engagement} engagements · <a href="${p.postUrl}" style="color:#3b82f6;">View</a></div>
      </td>
    </tr>
  `).join("");

  const errorRows = d.recentSyncErrors.length === 0
    ? `<tr><td style="padding:12px;color:#999;font-style:italic;">No sync errors in the last 24h.</td></tr>`
    : d.recentSyncErrors.map((e) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #fde2e2;vertical-align:top;background:#fef9f9;">
          <div style="font-weight:600;font-size:13px;">${e.clientName} <span style="color:#b91c1c;font-weight:400;">· ${PLATFORM_LABELS[e.platform] ?? e.platform}</span></div>
          <div style="font-size:12px;color:#7f1d1d;margin-top:3px;">${e.error.replace(/</g, "&lt;")}</div>
        </td>
      </tr>
    `).join("");

  return `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px;background:#f9fafb;color:#111;">
<div style="max-width:680px;margin:0 auto;background:white;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  <div style="background:#FE1B04;color:white;padding:20px 24px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;opacity:0.85;">social.gershoncrm.com</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px;">Daily digest — ${day}</div>
  </div>
  <div style="padding:20px 24px;background:#fff8f7;border-bottom:1px solid #fee2dd;">
    <div style="font-size:32px;font-weight:800;color:#FE1B04;line-height:1;">${d.totals.newPosts}</div>
    <div style="font-size:13px;color:#666;margin-top:4px;">new posts ingested in the last 24 hours across ${d.totals.clientsWithActivity} ${d.totals.clientsWithActivity === 1 ? "client" : "clients"}</div>
  </div>
  <div style="padding:18px 24px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px;">Per company</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="background:#f3f4f6;"><th style="text-align:left;padding:8px 12px;">Company</th><th style="text-align:right;padding:8px 12px;">New posts</th><th style="text-align:left;padding:8px 12px;">Platforms</th></tr></thead>
      <tbody>${companyRows || `<tr><td colspan="3" style="padding:12px;color:#999;font-style:italic;">No new posts in this window.</td></tr>`}</tbody>
    </table>
    ${d.quietCompanies > 0 ? `<div style="font-size:12px;color:#999;margin-top:8px;">${d.quietCompanies} active ${d.quietCompanies === 1 ? "company" : "companies"} had no new posts in this window.</div>` : ""}
  </div>
  <div style="padding:18px 24px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px;">Top posts by engagement</div>
    <table style="width:100%;border-collapse:collapse;">
      ${topPostRows || `<tr><td style="padding:12px;color:#999;font-style:italic;">Nothing to highlight today.</td></tr>`}
    </table>
  </div>
  <div style="padding:18px 24px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px;">Sync errors (last 24h)</div>
    <table style="width:100%;border-collapse:collapse;">
      ${errorRows}
    </table>
  </div>
  <div style="padding:18px 24px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px;">Coverage snapshot</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:8px 12px;background:#d1fae5;color:#065f46;font-weight:700;text-align:center;width:25%;">${d.coverageSummary.tier3}<br><span style="font-size:11px;font-weight:500;">✓✓✓ Up to date</span></td>
        <td style="padding:8px 12px;background:#fef3c7;color:#92400e;font-weight:700;text-align:center;width:25%;">${d.coverageSummary.tier2}<br><span style="font-size:11px;font-weight:500;">✓✓ Stale</span></td>
        <td style="padding:8px 12px;background:#fee2e2;color:#991b1b;font-weight:700;text-align:center;width:25%;">${d.coverageSummary.tier1}<br><span style="font-size:11px;font-weight:500;">✓ Link only</span></td>
        <td style="padding:8px 12px;background:#f3f4f6;color:#6b7280;font-weight:700;text-align:center;width:25%;">${d.coverageSummary.tier0}<br><span style="font-size:11px;font-weight:500;">Missing</span></td>
      </tr>
    </table>
    <div style="margin-top:12px;text-align:center;">
      <a href="https://social.gershoncrm.com/admin/coverage" style="display:inline-block;padding:10px 18px;background:#FE1B04;color:white;font-weight:600;font-size:13px;text-decoration:none;border-radius:8px;">Open Networks page →</a>
    </div>
  </div>
  <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#999;">
    Generated ${fmtDate(d.generatedAt)} · <a href="https://social.gershoncrm.com" style="color:#6b7280;">social.gershoncrm.com</a> · v${(process.env.NEXT_PUBLIC_APP_VERSION || "dev").slice(0, 7)}
  </div>
</div>
</body></html>
  `;
}

async function sendViaResend(html: string, subject: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set in environment" };
  const to = process.env.DIGEST_TO || "oattia@gmail.com";
  const from = process.env.DIGEST_FROM || "onboarding@resend.dev";
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
    const dateStr = new Date(d.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const companyWord = d.totals.clientsWithActivity === 1 ? "company" : "companies";
    const subject = `Report social.gershonCRM.com ${dateStr} — ${d.totals.newPosts} posts collected from ${d.totals.clientsWithActivity} ${companyWord}`;
    const send = await sendViaResend(html, subject);
    return NextResponse.json({
      success: send.ok,
      data: {
        digest: { totals: d.totals, perCompany: d.perCompany.map((c) => ({ name: c.name, newPosts: c.newPosts })) },
        send,
      },
    }, { status: send.ok ? 200 : 502 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "digest send failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
