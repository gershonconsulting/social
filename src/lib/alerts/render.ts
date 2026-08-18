/**
 * HTML for the posting alert emails. Inline styles only — every mail client
 * that matters strips <style> blocks. Brand: bold red on charcoal.
 */

import { fmtDate, type AlertCompany, type PostingAlert } from "./posting-alerts";

const RED = "#FE1B04";
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function tone(pct: number | null): { bg: string; fg: string; label: string } {
  if (pct === null) return { bg: "#f3f4f6", fg: MUTED, label: "no objective" };
  if (pct >= 95) return { bg: "#dcfce7", fg: "#15803d", label: "on target" };
  if (pct >= 80) return { bg: "#fef3c7", fg: "#b45309", label: "at risk" };
  return { bg: "#fee2e2", fg: "#b91c1c", label: "below target" };
}

function companyRow(c: AlertCompany, appUrl: string): string {
  const t = tone(c.attainmentPct);
  const missed = c.missedDates.length
    ? c.missedDates.map((d) => `<span style="display:inline-block;background:#fee2e2;color:#b91c1c;border-radius:5px;padding:2px 7px;margin:2px 4px 2px 0;font-size:12px;font-weight:600;">${esc(fmtDate(d))}</span>`).join("")
    : `<span style="color:${MUTED};font-size:13px;">none</span>`;
  return `
<tr>
  <td style="padding:14px 18px;border-top:1px solid ${LINE};vertical-align:top;">
    <a href="${appUrl}/clients/${esc(c.clientId)}" style="color:${INK};font-weight:700;font-size:15px;text-decoration:none;">${esc(c.name)}</a>
    <div style="color:${MUTED};font-size:11px;margin-top:3px;">basis: ${c.basis === "compliance" ? "verified compliance" : "derived from schedule"}</div>
  </td>
  <td style="padding:14px 10px;border-top:1px solid ${LINE};text-align:center;vertical-align:top;white-space:nowrap;">
    <span style="font-size:20px;font-weight:800;color:${INK};">${c.daysMet}</span><span style="color:${MUTED};font-size:14px;">/${c.objectiveDays}</span>
    <div style="color:${MUTED};font-size:11px;margin-top:2px;">days posted</div>
  </td>
  <td style="padding:14px 10px;border-top:1px solid ${LINE};text-align:center;vertical-align:top;white-space:nowrap;">
    <span style="display:inline-block;background:${t.bg};color:${t.fg};border-radius:999px;padding:4px 10px;font-size:12px;font-weight:800;">${c.attainmentPct === null ? "—" : c.attainmentPct + "%"}</span>
    <div style="color:${t.fg};font-size:11px;margin-top:3px;font-weight:600;">${t.label}</div>
  </td>
  <td style="padding:14px 18px;border-top:1px solid ${LINE};vertical-align:top;">
    <div style="color:${MUTED};font-size:11px;margin-bottom:3px;text-transform:uppercase;letter-spacing:.4px;font-weight:700;">${c.daysMissed} missed day${c.daysMissed === 1 ? "" : "s"}</div>
    ${missed}
  </td>
</tr>`;
}

export function renderAlertBody(a: PostingAlert): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";
  const kindLabel = a.kind === "week" ? "Weekly posting check" : "Monthly posting check";
  const t = tone(a.totals.attainmentPct);

  const onTargetLine = a.onTarget.filter((c) => c.objectiveDays > 0).length
    ? `<p style="margin:0;color:${MUTED};font-size:13px;">On target this period: ${a.onTarget.filter((c) => c.objectiveDays > 0).map((c) => esc(c.name)).join(", ")}.</p>`
    : "";
  const noObjective = a.onTarget.filter((c) => c.objectiveDays === 0);
  const noObjectiveLine = noObjective.length
    ? `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;">No posting objective configured (not counted): ${noObjective.map((c) => esc(c.name)).join(", ")}.</p>`
    : "";

  return `
<div style="background:${INK};padding:22px 24px;">
  <div style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:-.2px;">${kindLabel}</div>
  <div style="color:#9ca3af;font-size:13px;margin-top:4px;">${esc(a.periodLabel)} · ${esc(a.from)} → ${esc(a.to)} · campaign companies</div>
</div>

<div style="padding:20px 24px;background:#fff5f5;border-bottom:1px solid ${LINE};">
  <div style="color:${RED};font-size:15px;font-weight:800;">
    ${a.totals.companiesOffTarget} of ${a.totals.companies} companies did not post on every planned day.
  </div>
  <div style="color:${MUTED};font-size:13px;margin-top:6px;">
    Across all campaign companies: <b style="color:${INK};">${a.totals.daysMet}/${a.totals.objectiveDays}</b> planned days met
    (<span style="color:${t.fg};font-weight:800;">${a.totals.attainmentPct === null ? "—" : a.totals.attainmentPct + "%"}</span>),
    <b style="color:${INK};">${a.totals.daysMissed}</b> missed.
  </div>
</div>

<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
  <thead>
    <tr style="background:#f9fafb;">
      <th align="left" style="padding:9px 18px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Company</th>
      <th align="center" style="padding:9px 10px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Days</th>
      <th align="center" style="padding:9px 10px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Attainment</th>
      <th align="left" style="padding:9px 18px;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Days missed</th>
    </tr>
  </thead>
  <tbody>
    ${a.offTarget.map((c) => companyRow(c, appUrl)).join("")}
  </tbody>
</table>

<div style="padding:18px 24px;border-top:1px solid ${LINE};">
  ${onTargetLine}
  ${noObjectiveLine}
  <p style="margin:14px 0 0;">
    <a href="${appUrl}/summary" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:8px;">Open the dashboard</a>
  </p>
  <p style="margin:14px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">
    Objective is one post per planned day, measured at company-day level: a day counts as met when at
    least one tracked platform published. Sent only when a day was missed — a clean ${a.kind} is silent.
    Generated ${esc(new Date(a.generatedAt).toUTCString())} by social.gershonCRM.com.
  </p>
</div>`;
}

export function wrapAlertEmail(body: string): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px;background:#f3f4f6;color:${INK};">
<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
${body}
</div>
</body></html>`;
}

export function alertSubject(a: PostingAlert): string {
  const scope = a.kind === "week" ? `Week ${a.from} → ${a.to}` : a.periodLabel;
  return `⚠ social.gershonCRM.com — ${a.totals.companiesOffTarget} ${a.totals.companiesOffTarget === 1 ? "company" : "companies"} off plan — ${scope}`;
}
