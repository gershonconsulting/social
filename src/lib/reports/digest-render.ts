/**
 * HTML + subject of the daily digest ("Report social.gershonCRM.com <date> —").
 * Built by src/app/api/digest/daily/route.ts. Pure (no Prisma) so it can be
 * rendered with sample data for previews and tests.
 *
 * 2026-10-22 audit fixes:
 *   - "Last 24 hours" = posts PUBLISHED in the window (see ./digest-window.ts).
 *     Older back-filled posts and posts with an unknown publish date get their
 *     own section and are never counted, ranked or listed as last 24h.
 *   - Header: white card, Gershon red left border, dark text (readability).
 */
import { reportHeaderHtml, GC_RED, GC_TEXT } from "../email/report-header";

export interface DigestBackfillRow {
  id: string;
  name: string;
  older: number;
  unknown: number;
  /** Oldest publish date among this company's back-filled posts (ISO) — null when only unknown dates. */
  oldestPublishedAt: string | null;
}

export interface DigestData {
  generatedAt: string;
  window: { from: string; to: string };
  totals: {
    /** Posts PUBLISHED in the window. */
    newPosts: number;
    clientsWithActivity: number;
    /** Every post ingested in the window, whatever its publish date. */
    collected: number;
    olderPosts: number;
    unknownDatePosts: number;
  };
  perCompany: Array<{ id: string; name: string; category: string; newPosts: number; platforms: Array<{ platform: string; newPosts: number }> }>;
  quietCompanies: number;
  topPosts: Array<{ clientName: string; platform: string; snippet: string; postUrl: string; engagement: number; publishedAt: string }>;
  backfill: DigestBackfillRow[];
  recentSyncErrors: Array<{ clientName: string; platform: string; error: string; lastSyncAt: string | null }>;
  coverageSummary: { tier3: number; tier2: number; tier1: number; tier0: number; totalCells: number };
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
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

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderDigestHtml(d: DigestData): string {
  const fmtDate = (iso: string) => {
    if (!iso) return "date unknown";
    try { return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };
  const fmtDay = (iso: string) => {
    try { return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" }); }
    catch { return iso; }
  };
  const day = new Date(d.generatedAt).toLocaleDateString("en-US", { dateStyle: "full" });

  let lastCategory = "";
  const companyRows = d.perCompany.map((c) => {
    const catTotal = d.perCompany.filter((x) => x.category === c.category).reduce((s, x) => s + x.newPosts, 0);
    const header = c.category !== lastCategory ? `
    <tr>
      <td colspan="3" style="padding:10px 12px 6px;background:${c.category === "CAMPAIGN" ? "#fdf2f2" : "#f9fafb"};border-bottom:1px solid #e5e7eb;">
        <span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${c.category === "CAMPAIGN" ? GC_RED : "#374151"};">${esc(CATEGORY_LABELS[c.category] ?? c.category)}</span>
        <span style="font-size:11px;color:#9ca3af;margin-left:8px;">${catTotal} ${catTotal === 1 ? "post" : "posts"}</span>
      </td>
    </tr>` : "";
    lastCategory = c.category;
    return `${header}
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">
        <a href="https://social.gershon.ai/clients/${c.id}" style="color:${GC_TEXT};text-decoration:none;">${esc(c.name)}</a>
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
        <div style="font-weight:600;font-size:13px;">${esc(p.clientName)} <span style="color:#999;font-weight:400;">· ${PLATFORM_LABELS[p.platform] ?? p.platform}</span></div>
        <div style="font-size:13px;color:#444;margin-top:4px;">${esc(p.snippet)}</div>
        <div style="font-size:11px;color:#999;margin-top:6px;">${fmtDate(p.publishedAt)} · ${p.engagement} engagements · <a href="${p.postUrl}" style="color:${GC_RED};">View</a></div>
      </td>
    </tr>
  `).join("");

  const backfillTotal = d.totals.olderPosts + d.totals.unknownDatePosts;
  const backfillRows = d.backfill.map((b) => `
    <tr>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;font-size:13px;">
        <a href="https://social.gershon.ai/clients/${b.id}" style="color:${GC_TEXT};text-decoration:none;font-weight:600;">${esc(b.name)}</a>
      </td>
      <td style="padding:7px 12px;border-bottom:1px solid #eee;font-size:12px;color:#555;text-align:right;white-space:nowrap;">
        ${b.older > 0 ? `${b.older} older${b.oldestPublishedAt ? ` (from ${fmtDay(b.oldestPublishedAt)})` : ""}` : ""}${b.older > 0 && b.unknown > 0 ? " · " : ""}${b.unknown > 0 ? `<span style="color:#b45309;font-weight:600;">${b.unknown} publish date unknown</span>` : ""}
      </td>
    </tr>`).join("");
  const backfillBlock = backfillTotal === 0 ? "" : `
  <div style="padding:18px 24px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:4px;">Also collected — not counted as last 24h</div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">${d.totals.olderPosts} older ${d.totals.olderPosts === 1 ? "post" : "posts"} back-filled and ${d.totals.unknownDatePosts} with no readable publish date.</div>
    <table style="width:100%;border-collapse:collapse;">${backfillRows}</table>
  </div>`;

  const errorRows = d.recentSyncErrors.length === 0
    ? `<tr><td style="padding:12px;color:#999;font-style:italic;">No sync errors in the last 24h.</td></tr>`
    : d.recentSyncErrors.map((e) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #fde2e2;vertical-align:top;background:#fef9f9;">
          <div style="font-weight:600;font-size:13px;">${esc(e.clientName)} <span style="color:#b91c1c;font-weight:400;">· ${PLATFORM_LABELS[e.platform] ?? e.platform}</span></div>
          <div style="font-size:12px;color:#7f1d1d;margin-top:3px;">${esc(e.error)}</div>
        </td>
      </tr>
    `).join("");

  return `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px;background:#f7f7f8;color:${GC_TEXT};">
<div style="max-width:680px;margin:0 auto;background:white;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  ${reportHeaderHtml({ eyebrow: "social.gershon.ai", title: `Daily digest — ${day}` })}
  <div style="padding:20px 24px;background:#fdf2f2;border-bottom:1px solid #f3caca;">
    <div style="font-size:32px;font-weight:800;color:${GC_RED};line-height:1;">${d.totals.newPosts}</div>
    <div style="font-size:13px;color:#555;margin-top:4px;">new posts published in the last 24 hours across ${d.totals.clientsWithActivity} ${d.totals.clientsWithActivity === 1 ? "client" : "clients"}</div>
    ${backfillTotal > 0 ? `<div style="font-size:12px;color:#6b7280;margin-top:6px;">${d.totals.collected} posts collected in this window — ${backfillTotal} of them published earlier or undated, listed separately below.</div>` : ""}
  </div>
  <div style="padding:18px 24px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px;">Per company — published in the last 24h</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="background:#f3f4f6;"><th style="text-align:left;padding:8px 12px;">Company</th><th style="text-align:right;padding:8px 12px;">New posts</th><th style="text-align:left;padding:8px 12px;">Platforms</th></tr></thead>
      <tbody>${companyRows || `<tr><td colspan="3" style="padding:12px;color:#999;font-style:italic;">No new posts in this window.</td></tr>`}</tbody>
    </table>
    ${d.quietCompanies > 0 ? `<div style="font-size:12px;color:#999;margin-top:8px;">${d.quietCompanies} active ${d.quietCompanies === 1 ? "company" : "companies"} published nothing in this window.</div>` : ""}
  </div>
  <div style="padding:18px 24px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px;">Top posts of the last 24h by engagement</div>
    <table style="width:100%;border-collapse:collapse;">
      ${topPostRows || `<tr><td style="padding:12px;color:#999;font-style:italic;">Nothing to highlight today.</td></tr>`}
    </table>
  </div>
  ${backfillBlock}
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
      <a href="https://social.gershon.ai/networks" style="display:inline-block;padding:10px 18px;background:${GC_RED};color:white;font-weight:600;font-size:13px;text-decoration:none;border-radius:8px;">Open Networks page →</a>
    </div>
  </div>
  <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#999;">
    Generated ${fmtDate(d.generatedAt)} · <a href="https://social.gershon.ai" style="color:#6b7280;">social.gershon.ai</a> · v${(process.env.NEXT_PUBLIC_APP_VERSION || "dev").slice(0, 7)}
  </div>
</div>
</body></html>
  `;
}

/** Same prefix as before ("Report social.gershonCRM.com <date> —") so mail filters keep working. */
export function digestSubject(d: DigestData): string {
  const dateStr = new Date(d.generatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const n = d.totals.clientsWithActivity;
  const extra = d.totals.collected > d.totals.newPosts ? ` (${d.totals.collected} collected incl. older)` : "";
  return `Report social.gershonCRM.com ${dateStr} — ${d.totals.newPosts} posts published in the last 24h from ${n} ${n === 1 ? "company" : "companies"}${extra}`;
}
