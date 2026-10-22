/**
 * HTML for the posting alert emails. Inline styles only — every mail client
 * that matters strips <style> blocks.
 * 2026-10-22: white header card with Gershon red left border (was white on
 * charcoal); grey "not collected yet" days; "N of the days" cadence (WALLIX 3).
 */

import { fmtDate, type AlertCompany, type PostingAlert } from "./posting-alerts";
import { siteUrl } from "@/lib/site";
import { reportHeaderHtml, GC_RED } from "@/lib/email/report-header";

const RED = GC_RED;
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
  const missedChips = c.missedDates.map((d) => `<span style="display:inline-block;background:#fee2e2;color:#b91c1c;border-radius:5px;padding:2px 7px;margin:2px 4px 2px 0;font-size:12px;font-weight:600;">${esc(fmtDate(d))}</span>`).join("");
  const pendingChips = (c.pendingDates ?? []).map((d) => `<span title="not collected since this day" style="display:inline-block;background:#f3f4f6;color:${MUTED};border:1px dashed #d1d5db;border-radius:5px;padding:1px 6px;margin:2px 4px 2px 0;font-size:12px;">${esc(fmtDate(d))} · not collected yet</span>`).join("");
  const flexibleNote = c.flexible
    ? `<div style="color:${MUTED};font-size:12px;margin:2px 0 4px;">Objective ${c.perWeek}/week — any ${c.objectiveDays} of the planned days.</div>`
    : "";
  const missed = missedChips || pendingChips
    ? flexibleNote + missedChips + pendingChips
    : flexibleNote + `<span style="color:${MUTED};font-size:13px;">none</span>`;
  return `
<tr>
  <td style="padding:14px 18px;border-top:1px solid ${LINE};vertical-align:top;">
    <a href="${appUrl}/clients/${esc(c.clientId)}" style="color:${INK};font-weight:700;font-size:15px;text-decoration:none;">${esc(c.name)}</a>
    <div style="color:${MUTED};font-size:11px;margin-top:3px;">basis: ${c.basis === "compliance" ? "verified compliance" : "derived from schedule"}${c.lastReadAt ? ` · last collected ${esc(new Date(c.lastReadAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }))}` : " · never collected"}</div>
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
  const appUrl = siteUrl();
  const kindLabel = a.kind === "week" ? "Weekly posting check" : "Monthly posting check";
  const t = tone(a.totals.attainmentPct);

  // A company whose unposted days are all "not collected yet" is not on target — it is unjudged.
  const unjudged = (c: AlertCompany) => (c.pendingDates?.length ?? 0) > 0 && c.daysMet < c.objectiveDays;
  const judgedOk = a.onTarget.filter((c) => c.objectiveDays > 0 && !unjudged(c));
  const waiting = a.onTarget.filter((c) => c.objectiveDays > 0 && unjudged(c));
  const onTargetLine = judgedOk.length
    ? `<p style="margin:0;color:${MUTED};font-size:13px;">On target this period: ${judgedOk.map((c) => esc(c.name)).join(", ")}.</p>`
    : "";
  const lastRead = (c: AlertCompany) => c.lastReadAt
    ? `last collected ${esc(new Date(c.lastReadAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }))}`
    : "never collected";
  const waitingLine = waiting.length
    ? `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;">Not judged yet — not collected since the days in question: ${waiting.map((c) => `<b style="color:${INK};">${esc(c.name)}</b> (${c.daysMet}/${c.objectiveDays} so far, ${lastRead(c)})`).join(", ")}. Run a collection for them; the check re-runs over the weekend.</p>`
    : "";
  const noObjective = a.onTarget.filter((c) => c.objectiveDays === 0);
  const noObjectiveLine = noObjective.length
    ? `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;">No posting objective configured (not counted): ${noObjective.map((c) => esc(c.name)).join(", ")}.</p>`
    : "";

  return `
${reportHeaderHtml({ eyebrow: "social.gershonCRM.com", title: kindLabel, subtitle: `${a.periodLabel} · ${a.from} → ${a.to} · campaign companies` })}

<div style="padding:20px 24px;background:#fff5f5;border-bottom:1px solid ${LINE};">
  <div style="color:${RED};font-size:15px;font-weight:800;">
    ${a.totals.companiesOffTarget} of ${a.totals.companies} companies did not post on every planned day.
  </div>
  <div style="color:${MUTED};font-size:13px;margin-top:6px;">
    Across all campaign companies: <b style="color:${INK};">${a.totals.daysMet}/${a.totals.objectiveDays}</b> planned days met
    (<span style="color:${t.fg};font-weight:800;">${a.totals.attainmentPct === null ? "—" : a.totals.attainmentPct + "%"}</span>),
    <b style="color:${INK};">${a.totals.daysMissed}</b> missed${(a.totals.daysPending ?? 0) > 0 ? `, <b style="color:${INK};">${a.totals.daysPending}</b> not collected yet (not counted)` : ""}.
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
  ${waitingLine}
  ${noObjectiveLine}
  <p style="margin:14px 0 0;">
    <a href="${appUrl}/summary" style="display:inline-block;background:${RED};color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px;border-radius:8px;">Open the dashboard</a>
  </p>
  <p style="margin:14px 0 0;color:#9ca3af;font-size:11px;line-height:1.5;">
    Objective is one post per planned day (or the company's posts-per-week objective from Settings), measured
    at company-day level in New York time: a day counts as met when at least one tracked platform published.
    A day with no post is only a miss once the company has been collected after that day; until then it is
    "not collected yet". Sent only when a day was missed — a clean ${a.kind} is silent.
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
