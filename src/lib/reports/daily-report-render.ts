/**
 * HTML for the daily progress report email.
 *
 * Inline CSS only — Gmail strips <style> blocks. Gershon red (#FE1B04) on
 * white, matching the daily digest so the two read as one family.
 *
 * The visual hierarchy is deliberate: if the system failed to do its job, the
 * failure is the biggest thing on the screen and everything else is detail.
 */

import type { DailyReport, Metric } from "./daily-report";

const RED = "#FE1B04";
const SITE = "https://social.gershoncrm.com";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  RECYCLED: "Recycled",
};

const fmt = (n: number | null): string =>
  n === null ? "—" : Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1);

/** "▲ +12 (+18%)" / "▼ −40 (−31%)" / "= 0", coloured by whether it is good. */
function deltaCell(current: number | null, baseline: number | null, higherIsBetter: boolean): string {
  if (current === null || baseline === null) {
    return `<span style="color:#9ca3af;">—</span>`;
  }
  const diff = current - baseline;
  if (Math.abs(diff) < 0.5) {
    return `<span style="color:#9ca3af;">= 0</span>`;
  }
  const good = diff > 0 === higherIsBetter;
  const color = good ? "#059669" : "#b91c1c";
  const arrow = diff > 0 ? "▲" : "▼";
  const pct = baseline > 0 ? ` (${diff > 0 ? "+" : "−"}${Math.round((Math.abs(diff) / baseline) * 100)}%)` : "";
  const sign = diff > 0 ? "+" : "−";
  return `<span style="color:${color};font-weight:700;">${arrow} ${sign}${fmt(Math.abs(Math.round(diff * 10) / 10))}${pct}</span>`;
}

function metricRow(m: Metric): string {
  return `
  <tr>
    <td style="padding:11px 12px;border-bottom:1px solid #eee;">
      <div style="font-weight:600;font-size:14px;color:#111;">${esc(m.label)}</div>
      ${m.hint ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${esc(m.hint)}</div>` : ""}
    </td>
    <td style="padding:11px 12px;border-bottom:1px solid #eee;text-align:right;font-size:22px;font-weight:800;color:#111;white-space:nowrap;">${fmt(m.yesterday)}</td>
    <td style="padding:11px 12px;border-bottom:1px solid #eee;text-align:right;font-size:13px;white-space:nowrap;">
      <div style="color:#6b7280;">${fmt(m.dayBefore)}</div>
      <div style="margin-top:2px;">${deltaCell(m.yesterday, m.dayBefore, m.higherIsBetter)}</div>
    </td>
    <td style="padding:11px 12px;border-bottom:1px solid #eee;text-align:right;font-size:13px;white-space:nowrap;">
      <div style="color:#6b7280;">${fmt(m.avg7 === null ? null : Math.round(m.avg7 * 10) / 10)}</div>
      <div style="margin-top:2px;">${deltaCell(m.yesterday, m.avg7 === null ? null : Math.round(m.avg7 * 10) / 10, m.higherIsBetter)}</div>
    </td>
  </tr>`;
}

function statusBlock(r: DailyReport): string {
  const s = r.status;
  if (s.level === "critical") {
    return `
  <div style="background:#7f1d1d;color:#fff;padding:26px 24px;border-bottom:4px solid ${RED};">
    <div style="font-size:13px;font-weight:800;letter-spacing:2px;text-transform:uppercase;opacity:0.85;">⛔ Critical — action required</div>
    <div style="font-size:26px;font-weight:900;line-height:1.2;margin-top:10px;">${esc(s.headline)}</div>
    <div style="font-size:14px;line-height:1.55;margin-top:12px;opacity:0.95;">${esc(s.detail)}</div>
    <div style="margin-top:16px;">
      <a href="${SITE}/extension" style="display:inline-block;padding:11px 20px;background:#fff;color:#7f1d1d;font-weight:800;font-size:13px;text-decoration:none;border-radius:8px;">Run a full sync now →</a>
    </div>
  </div>`;
  }
  if (s.level === "warn") {
    return `
  <div style="background:#fef3c7;color:#78350f;padding:22px 24px;border-bottom:1px solid #fde68a;">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">⚠️ Warning</div>
    <div style="font-size:20px;font-weight:800;line-height:1.25;margin-top:8px;">${esc(s.headline)}</div>
    <div style="font-size:14px;line-height:1.55;margin-top:8px;">${esc(s.detail)}</div>
  </div>`;
  }
  return `
  <div style="background:#ecfdf5;color:#065f46;padding:18px 24px;border-bottom:1px solid #d1fae5;">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">✓ System healthy</div>
    <div style="font-size:18px;font-weight:800;margin-top:6px;">${esc(s.headline)}</div>
    <div style="font-size:14px;margin-top:4px;">${esc(s.detail)}</div>
  </div>`;
}

function extensionBlock(r: DailyReport): string {
  const e = r.extension;
  if (e.level === "ok") {
    return `
  <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:13px;color:#059669;">
    ✓ ${esc(e.headline)}
  </div>`;
  }
  const critical = e.level === "critical";
  const bg = critical ? "#fef2f2" : "#fffbeb";
  const border = critical ? RED : "#f59e0b";
  const fg = critical ? "#7f1d1d" : "#78350f";
  return `
  <div style="margin:0;padding:20px 24px;background:${bg};border-top:1px solid #e5e7eb;border-left:6px solid ${border};">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${border};">
      ${critical ? "⛔ Chrome extension out of date" : "⚠️ Chrome extension"}
    </div>
    <div style="font-size:17px;font-weight:800;color:${fg};margin-top:8px;line-height:1.3;">${esc(e.headline)}</div>
    ${e.detail ? `<div style="font-size:13px;color:${fg};margin-top:8px;line-height:1.55;">${esc(e.detail)}</div>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px;color:${fg};">
      <tr>
        <td style="padding:4px 0;width:120px;color:#6b7280;">Installed</td>
        <td style="padding:4px 0;font-weight:700;">${e.installed ? `v${esc(e.installed)}` : "not detected"}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#6b7280;">Latest</td>
        <td style="padding:4px 0;font-weight:700;">v${esc(e.latest)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#6b7280;">Last seen</td>
        <td style="padding:4px 0;">${e.lastSeenAt ? esc(new Date(e.lastSeenAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })) : "never"}</td>
      </tr>
    </table>
    <div style="margin-top:14px;font-size:13px;color:${fg};">
      <div style="font-weight:700;margin-bottom:6px;">Two ways to update — either works:</div>
      <div style="margin-bottom:8px;">
        <b>1. Download from the site</b> —
        <a href="${e.downloadUrl}" style="color:${RED};font-weight:600;">${esc(e.downloadUrl)}</a>,
        unzip it, then open <code style="background:#fff;padding:1px 4px;border-radius:3px;">chrome://extensions/</code>,
        remove the old GershonAI card and use <b>Load unpacked</b> on the new folder.
      </div>
      <div>
        <b>2. Reload the local copy</b> — open <code style="background:#fff;padding:1px 4px;border-radius:3px;">chrome://extensions/</code>
        and click the reload icon on the GershonAI card, pointing at
        <code style="background:#fff;padding:1px 4px;border-radius:3px;word-break:break-all;">${esc(e.localPath)}</code>
      </div>
    </div>
    <div style="margin-top:14px;">
      <a href="${SITE}/extension" style="display:inline-block;padding:10px 18px;background:${border};color:#fff;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;">Open the Extension page →</a>
    </div>
  </div>`;
}

export function renderDailyReportHtml(r: DailyReport): string {
  const moverRows = r.movers
    .map(
      (m) => `
    <tr>
      <td style="padding:7px 12px;border-bottom:1px solid #f3f4f6;">
        <a href="${SITE}/clients/${m.id}" style="color:#111;text-decoration:none;font-weight:600;font-size:13px;">${esc(m.name)}</a>
        <span style="font-size:11px;color:#9ca3af;"> · ${esc(CATEGORY_LABELS[m.category] ?? m.category)}</span>
      </td>
      <td style="padding:7px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;font-size:15px;">${m.yesterday}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-size:12px;">${deltaCell(m.yesterday, m.dayBefore, true)}</td>
    </tr>`,
    )
    .join("");

  const quietRows = r.wentQuiet
    .map(
      (q) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;">
        <a href="${SITE}/clients/${q.id}" style="color:#111;text-decoration:none;">${esc(q.name)}</a>
      </td>
      <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-size:12px;color:#6b7280;">${q.dayBefore} the day before → 0</td>
    </tr>`,
    )
    .join("");

  const errorRows =
    r.errors.length === 0
      ? `<tr><td style="padding:12px;color:#9ca3af;font-style:italic;font-size:13px;">No connections are currently in error.</td></tr>`
      : r.errors
          .map(
            (e) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #fde2e2;background:#fef9f9;">
        <div style="font-weight:600;font-size:13px;">${esc(e.clientName)} <span style="color:#b91c1c;font-weight:400;">· ${esc(PLATFORM_LABELS[e.platform] ?? e.platform)}</span></div>
        <div style="font-size:12px;color:#7f1d1d;margin-top:3px;">${esc(e.error)}</div>
      </td>
    </tr>`,
          )
          .join("");

  const p = r.progress;
  const progressColor = p.level === "warn" ? "#b45309" : "#065f46";
  const progressBg = p.level === "warn" ? "#fffbeb" : "#f0fdf4";

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:24px;background:#f3f4f6;color:#111;">
<div style="max-width:700px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

  <div style="background:${RED};color:#fff;padding:20px 24px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.6px;opacity:0.88;">social.gershonCRM.com</div>
    <div style="font-size:23px;font-weight:800;margin-top:4px;">Daily Report</div>
    <div style="font-size:14px;margin-top:2px;opacity:0.92;">${esc(r.day.label)}</div>
  </div>

  ${statusBlock(r)}

  <div style="padding:16px 24px;background:${progressBg};border-bottom:1px solid #e5e7eb;">
    <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;">Progress vs the day before</div>
    <div style="font-size:17px;font-weight:800;color:${progressColor};margin-top:5px;">${esc(p.headline)}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">${p.improved} up · ${p.declined} down · ${p.flat} unchanged</div>
  </div>

  <div style="padding:18px 24px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">Scorecard</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th style="text-align:left;padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;">Measure</th>
          <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;">Yesterday</th>
          <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;">Day before</th>
          <th style="text-align:right;padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#6b7280;">7-day avg</th>
        </tr>
      </thead>
      <tbody>${r.metrics.map(metricRow).join("")}</tbody>
    </table>
  </div>

  <div style="padding:4px 24px 18px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">Where the movement came from</div>
    <table style="width:100%;border-collapse:collapse;">
      <tbody>${moverRows || `<tr><td style="padding:12px;color:#9ca3af;font-style:italic;font-size:13px;">No company produced new content yesterday.</td></tr>`}</tbody>
    </table>
  </div>

  ${
    r.wentQuiet.length > 0
      ? `<div style="padding:4px 24px 18px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">Went quiet since the day before</div>
    <table style="width:100%;border-collapse:collapse;"><tbody>${quietRows}</tbody></table>
  </div>`
      : ""
  }

  <div style="padding:4px 24px 18px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#6b7280;margin-bottom:10px;">Connections in error</div>
    <table style="width:100%;border-collapse:collapse;"><tbody>${errorRows}</tbody></table>
  </div>

  ${extensionBlock(r)}

  <div style="padding:16px 24px;background:#111;text-align:center;">
    <a href="${SITE}/dashboard" style="display:inline-block;padding:11px 22px;background:${RED};color:#fff;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;">Open the dashboard →</a>
  </div>

  <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
    Generated by social.gershonCRM.com on ${esc(new Date(r.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }))} ·
    app v${esc((process.env.NEXT_PUBLIC_APP_VERSION || "dev").slice(0, 7))} ·
    extension v${esc(r.extension.installed ?? "?")} of v${esc(r.extension.latest)}
  </div>
</div>
</body></html>`;
}

/** platform-report-email convention: "<Platform> Report — <Date range>". */
export function dailyReportSubject(r: DailyReport): string {
  const base = `Social Report — ${r.day.short}`;
  if (r.status.level === "critical") return `⛔ NO COLLECTION — ${base}`;
  if (r.extension.level === "critical") return `⚠️ Extension out of date — ${base}`;
  if (r.status.level === "warn") return `⚠️ ${base} — collection ran short`;
  const posts = r.metrics.find((m) => m.key === "posts")?.yesterday ?? 0;
  const companies = r.metrics.find((m) => m.key === "companies")?.yesterday ?? 0;
  return `${base} — ${posts} posts from ${companies} ${companies === 1 ? "company" : "companies"}`;
}
