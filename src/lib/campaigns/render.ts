/**
 * One-page renderers for the campaign monthly report.
 *
 * The same body HTML is used for the emailed document and for the
 * token-protected web page, so what sales reads in Gmail and what a client
 * sees at the share link can never drift apart. Everything is inline CSS
 * and table-based — Gmail strips <style> blocks and ignores flexbox.
 *
 * "One page" is enforced by content, not by CSS: header + KPI strip +
 * one row per company + footer. A print stylesheet is injected only for
 * the standalone page (wrapDocument), which is how a PDF gets produced —
 * Cloudflare Workers have no headless browser, so Cmd/Ctrl-P → Save as
 * PDF from the share link is the PDF path.
 */

import type { CampaignMonth, CampaignMonthlyReport } from "./monthly";
import { APP_URL } from "./monthly";

const RED = "#FE1B04";
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X",
  GOOGLE_BUSINESS: "Google Business",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  THREADS: "Threads",
  PINTEREST: "Pinterest",
  MEDIUM: "Medium",
  REDDIT: "Reddit",
  BLOG_RSS: "Blog",
  OTHER: "Other",
};

const STATUS_STYLE: Record<CampaignMonth["status"], { bg: string; fg: string; label: string }> = {
  ON_TARGET: { bg: "#d1fae5", fg: "#065f46", label: "On target" },
  AT_RISK: { bg: "#fef3c7", fg: "#92400e", label: "At risk" },
  BELOW_TARGET: { bg: "#fee2e2", fg: "#991b1b", label: "Below target" },
  NO_DATA: { bg: "#f3f4f6", fg: "#6b7280", label: "No data" },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pctText(p: number | null): string {
  return p === null ? "—" : `${p}%`;
}

/** Trend chip: ▲ +4.2 pts / ▼ -6.0 pts / = flat, vs the prior month. */
function trend(current: number | null, previous: number | null): string {
  if (current === null || previous === null) {
    return `<span style="font-size:11px;color:${MUTED};">no prior month</span>`;
  }
  const delta = Math.round((current - previous) * 10) / 10;
  if (Math.abs(delta) < 0.1) {
    return `<span style="font-size:11px;color:${MUTED};">= flat vs ${previous}%</span>`;
  }
  const up = delta > 0;
  return `<span style="font-size:11px;font-weight:700;color:${up ? "#059669" : "#dc2626"};">${
    up ? "▲" : "▼"
  } ${up ? "+" : ""}${delta} pts</span> <span style="font-size:11px;color:${MUTED};">vs ${previous}%</span>`;
}

function kpi(value: string, label: string, accent = false): string {
  return `
  <td style="padding:12px 10px;text-align:center;border-right:1px solid ${LINE};">
    <div style="font-size:26px;font-weight:800;line-height:1;color:${accent ? RED : INK};">${value}</div>
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};margin-top:6px;">${label}</div>
  </td>`;
}

function header(title: string, subtitle: string): string {
  return `
  <div style="background:${RED};color:#ffffff;padding:20px 24px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.6px;opacity:0.85;">social.gershonCRM.com · Campaign report</div>
    <div style="font-size:22px;font-weight:800;margin-top:5px;line-height:1.2;">${esc(title)}</div>
    <div style="font-size:13px;margin-top:3px;opacity:0.9;">${esc(subtitle)}</div>
  </div>`;
}

function footer(r: CampaignMonthlyReport, shareUrl: string): string {
  const when = new Date(r.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const v = (process.env.NEXT_PUBLIC_APP_VERSION || "dev").slice(0, 7);
  return `
  <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid ${LINE};font-size:11px;color:${MUTED};line-height:1.6;">
    Objective: <strong style="color:${INK};">one post per day</strong>. A day counts as met when at least one tracked platform published that day.<br>
    Generated ${when} · <a href="${shareUrl}" style="color:${MUTED};">permanent link</a> · <a href="${APP_URL}" style="color:${MUTED};">social.gershonCRM.com</a> · v${v}
  </div>`;
}

function shareBanner(url: string): string {
  return `
  <div style="padding:14px 24px;background:#fff8f7;border-bottom:1px solid #fee2dd;text-align:center;">
    <a href="${url}" style="display:inline-block;padding:10px 20px;background:${RED};color:#ffffff;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;">Open the live report →</a>
    <div style="font-size:11px;color:${MUTED};margin-top:8px;word-break:break-all;">${url}</div>
  </div>`;
}

// ─── Summary: every campaign company on one page ──────────────────────────────

export function renderSummaryBody(r: CampaignMonthlyReport): string {
  const rows = r.companies
    .map((c) => {
      const st = STATUS_STYLE[c.status];
      const platforms = c.platforms.length
        ? c.platforms.map((p) => `${PLATFORM_LABELS[p.platform] ?? p.platform} ${p.posts}`).join(" · ")
        : "—";
      return `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid ${LINE};">
        <a href="${c.shareUrl}" style="color:${INK};text-decoration:none;font-weight:700;font-size:14px;">${esc(c.name)}</a>
        <div style="font-size:11px;color:${MUTED};margin-top:2px;">${platforms}${
          c.basis === "derived" ? ' · <span style="color:#b45309;">derived</span>' : ""
        }</div>
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid ${LINE};text-align:center;font-weight:700;">${c.postsPublished}</td>
      <td style="padding:9px 12px;border-bottom:1px solid ${LINE};text-align:center;">${c.daysMet}<span style="color:${MUTED};">/${c.objectiveDays}</span></td>
      <td style="padding:9px 12px;border-bottom:1px solid ${LINE};text-align:center;font-weight:700;color:${
        c.daysMissed > 0 ? "#dc2626" : MUTED
      };">${c.daysMissed}</td>
      <td style="padding:9px 12px;border-bottom:1px solid ${LINE};text-align:right;">
        <div style="font-size:17px;font-weight:800;color:${st.fg};">${pctText(c.attainmentPct)}</div>
        <div style="margin-top:2px;">${trend(c.attainmentPct, c.previous?.attainmentPct ?? null)}</div>
      </td>
      <td style="padding:9px 12px;border-bottom:1px solid ${LINE};text-align:center;">
        <span style="display:inline-block;padding:3px 8px;border-radius:99px;background:${st.bg};color:${st.fg};font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;">${st.label}</span>
      </td>
    </tr>`;
    })
    .join("");

  return `
  ${header(`Campaign performance — ${r.monthLabel}`, `${r.totals.companies} campaign ${r.totals.companies === 1 ? "company" : "companies"} · objective: one post per day`)}
  <table style="width:100%;border-collapse:collapse;background:#fff8f7;border-bottom:1px solid #fee2dd;">
    <tr>
      ${kpi(pctText(r.totals.attainmentPct), "Objective met", true)}
      ${kpi(String(r.totals.postsPublished), "Posts published")}
      ${kpi(`${r.totals.daysMet}/${r.totals.objectiveDays}`, "Days met")}
      ${kpi(String(r.totals.daysMissed), "Days missed")}
      ${kpi(r.totals.totalEngagement.toLocaleString("en-US"), "Engagements")}
    </tr>
  </table>
  <div style="padding:10px 24px 4px;font-size:12px;color:${MUTED};">
    Across all campaigns: ${trend(r.totals.attainmentPct, r.totals.previousAttainmentPct)} (${r.previousMonthLabel})
  </div>
  <div style="padding:8px 16px 16px;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="text-align:left;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};">Company</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};">Posts</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};">Days met</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};">Missed</th>
          <th style="text-align:right;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};">Objective met</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};">Status</th>
        </tr>
      </thead>
      <tbody>${
        rows ||
        `<tr><td colspan="6" style="padding:16px;color:${MUTED};font-style:italic;">No campaign companies found for this month.</td></tr>`
      }</tbody>
    </table>
  </div>
  ${shareBanner(r.shareUrl)}
  ${footer(r, r.shareUrl)}`;
}

// ─── Per-company one-pager ────────────────────────────────────────────────────

export function renderCompanyBody(r: CampaignMonthlyReport, c: CampaignMonth): string {
  const st = STATUS_STYLE[c.status];

  const platformRows = c.platforms.length
    ? c.platforms
        .map(
          (p) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};font-weight:600;">${PLATFORM_LABELS[p.platform] ?? p.platform}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};text-align:center;">${p.posts}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${LINE};text-align:right;">${p.engagement.toLocaleString("en-US")}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" style="padding:12px;color:${MUTED};font-style:italic;">No posts collected this month.</td></tr>`;

  const missed = c.missedDates.length
    ? `<div style="padding:0 24px 16px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};margin-bottom:6px;">Days missed (${c.missedDates.length})</div>
        <div style="font-size:12px;color:#991b1b;background:#fef2f2;border:1px solid #fee2e2;border-radius:8px;padding:10px 12px;line-height:1.8;">
          ${c.missedDates.map((d) => d.slice(8)).join(" · ")}
          <span style="color:${MUTED};"> (day of month)</span>
        </div>
      </div>`
    : `<div style="padding:0 24px 16px;">
        <div style="font-size:13px;color:#065f46;background:#ecfdf5;border:1px solid #d1fae5;border-radius:8px;padding:12px;font-weight:600;">
          Every expected posting day was met this month.
        </div>
      </div>`;

  const best = c.bestPost
    ? `<div style="padding:0 24px 18px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};margin-bottom:6px;">Best-performing post</div>
        <div style="border:1px solid ${LINE};border-radius:8px;padding:12px;">
          <div style="font-size:11px;color:${MUTED};">${PLATFORM_LABELS[c.bestPost.platform] ?? c.bestPost.platform} · ${c.bestPost.engagement.toLocaleString("en-US")} engagements</div>
          <div style="font-size:13px;color:${INK};margin-top:5px;line-height:1.5;">${esc(c.bestPost.snippet)}</div>
          <a href="${c.bestPost.url}" style="font-size:12px;color:${RED};font-weight:600;text-decoration:none;">View post →</a>
        </div>
      </div>`
    : "";

  const p = c.previous;
  const prevRow = p
    ? `<tr>
        <td style="padding:8px 12px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;">${r.previousMonthLabel}</td>
        <td style="padding:8px 12px;border-top:1px solid ${LINE};text-align:center;color:${MUTED};font-size:12px;">${p.postsPublished}</td>
        <td style="padding:8px 12px;border-top:1px solid ${LINE};text-align:center;color:${MUTED};font-size:12px;">${p.daysMet}/${p.objectiveDays}</td>
        <td style="padding:8px 12px;border-top:1px solid ${LINE};text-align:center;color:${MUTED};font-size:12px;">${p.daysMissed}</td>
        <td style="padding:8px 12px;border-top:1px solid ${LINE};text-align:right;color:${MUTED};font-size:12px;">${pctText(p.attainmentPct)}</td>
      </tr>`
    : "";

  return `
  ${header(esc(c.name), `${r.monthLabel} · objective: one post per day`)}
  <table style="width:100%;border-collapse:collapse;background:#fff8f7;border-bottom:1px solid #fee2dd;">
    <tr>
      ${kpi(pctText(c.attainmentPct), "Objective met", true)}
      ${kpi(String(c.postsPublished), "Posts published")}
      ${kpi(String(c.objectiveDays), "Objective days")}
      ${kpi(String(c.daysMissed), "Days missed")}
      ${kpi(c.totalEngagement.toLocaleString("en-US"), "Engagements")}
    </tr>
  </table>
  <div style="padding:14px 24px;border-bottom:1px solid ${LINE};">
    <span style="display:inline-block;padding:5px 12px;border-radius:99px;background:${st.bg};color:${st.fg};font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">${st.label}</span>
    <span style="margin-left:10px;">${trend(c.attainmentPct, c.previous?.attainmentPct ?? null)}</span>
    ${
      c.basis === "derived"
        ? `<div style="font-size:11px;color:#b45309;margin-top:8px;">Objective days derived from the posting schedule — daily compliance has not been computed for this month yet.</div>`
        : ""
    }
  </div>
  <div style="padding:16px 24px 6px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};margin-bottom:8px;">Month vs previous month</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="text-align:left;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Period</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Posts</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Days met</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Missed</th>
          <th style="text-align:right;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Objective met</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:8px 12px;font-weight:700;">${r.monthLabel}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700;">${c.postsPublished}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700;">${c.daysMet}/${c.objectiveDays}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700;color:${c.daysMissed > 0 ? "#dc2626" : INK};">${c.daysMissed}</td>
          <td style="padding:8px 12px;text-align:right;font-weight:800;color:${st.fg};">${pctText(c.attainmentPct)}</td>
        </tr>
        ${prevRow}
      </tbody>
    </table>
  </div>
  <div style="padding:16px 24px 6px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};margin-bottom:8px;">By platform</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="text-align:left;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Platform</th>
          <th style="text-align:center;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Posts</th>
          <th style="text-align:right;padding:8px 12px;font-size:10px;text-transform:uppercase;color:${MUTED};">Engagements</th>
        </tr>
      </thead>
      <tbody>${platformRows}</tbody>
    </table>
  </div>
  <div style="height:14px;"></div>
  ${missed}
  ${best}
  ${shareBanner(c.shareUrl)}
  ${footer(r, c.shareUrl)}`;
}

// ─── Document wrappers ────────────────────────────────────────────────────────

/** Email-safe full document: no scripts, no print controls. */
export function wrapEmail(body: string): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px;background:#f3f4f6;color:${INK};">
<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
${body}
</div>
</body></html>`;
}

/**
 * Standalone page document: same body plus a print bar. Printing to PDF
 * from here is the supported way to get a PDF file — the Worker runtime
 * has no PDF engine.
 */
export function wrapPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px;background:#f3f4f6;color:${INK};}
  .sheet{max-width:820px;margin:0 auto;background:#fff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;}
  .bar{max-width:820px;margin:0 auto 12px;text-align:right;}
  .bar button{background:${RED};color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;}
  @media print{
    body{background:#fff;padding:0;}
    .bar{display:none;}
    .sheet{border:0;border-radius:0;max-width:none;}
    @page{size:A4;margin:10mm;}
  }
</style>
</head><body>
<div class="bar"><button onclick="window.print()">Save as PDF / Print</button></div>
<div class="sheet">${body}</div>
</body></html>`;
}
