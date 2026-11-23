/**
 * The Daily brief (v4.82.0) — ONE email a day instead of five.
 *
 * Sections (each only when its own Settings → Reports entry is due today):
 *   1. Collection   (was "Social Collection Report")
 *   2. Posting      (was "Social Posting Report")
 *   3. Competitive  (was "Competitive Report")
 *   4. Intelligence (was "Social Intelligence Report" → sales@)
 *   5. Digest       (was "Daily Digest")
 * Alerts (collection failed / ran short, extension out of date, LinkedIn signed
 * out) are a banner on top. Recipients = everyone who received any of the five.
 *
 * Each section is rendered by its existing endpoint in its OWN request (one
 * fetch per section) so this job never runs out of Worker subrequests.
 * Idempotent per ET day (Setting `daily_brief_sent`) + Resend Idempotency-Key.
 */
import prisma from "@/lib/db";
import { buildDailyReport, DEFAULT_REPORT_TO } from "../daily-report";
import { renderDailyReportHtml } from "../daily-report-render";
import { reportPlan, envFallback } from "../settings";
import { primaryOrgId } from "../monthly/data";
import { OPS_FROM, SITE } from "../ops/shell";
import { postsFromCompanies, workspaceLabel } from "../report-subject";
import { withAuditBcc } from "@/lib/mail-bcc";
import { withGcName } from "@/lib/email/sender";
import { sendResend } from "@/lib/resend-send";
import { combineEmail, dailyBriefSubject, type Alert, type Section } from "./combine";

export const BRIEF_SENT_KEY = "daily_brief_sent";

type Part = { id: string; title: string; path: string | null };
const PARTS: Part[] = [
  { id: "collection", title: "Collection — did the collector do its job", path: null },
  { id: "posting", title: "Posting — did every campaign company post", path: "/api/report/ops?kind=posting" },
  { id: "competitive", title: "Competitive — what competitors and partners posted", path: "/api/report/ops?kind=competitive" },
  { id: "intelligence", title: "Intelligence — actions for sales", path: "/api/report/ops?kind=intelligence" },
  { id: "digest", title: "Digest — company by company", path: "/api/digest/daily" },
];

async function fetchSection(path: string): Promise<string> {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || "";
  const r = await fetch(`${SITE}${path}`, { headers: { Authorization: `Bearer ${secret}` } });
  const text = await r.text();
  if (!r.ok || !/<(html|body|div|table)/i.test(text)) throw new Error(`HTTP ${r.status}`);
  return text;
}

async function readSent(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: BRIEF_SENT_KEY } }).catch(() => null);
  try {
    const v = row?.value ? JSON.parse(row.value) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
async function markSent(day: string, note: string) {
  const s = await readSent();
  s[day] = `${new Date().toISOString()} ${note}`;
  const keys = Object.keys(s).sort();
  while (keys.length > 30) delete s[keys.shift() as string];
  const value = JSON.stringify(s);
  await prisma.setting.upsert({ where: { key: BRIEF_SENT_KEY }, update: { value }, create: { key: BRIEF_SENT_KEY, value } });
}

async function linkedInAlert(): Promise<Alert | null> {
  try {
    const org = await primaryOrgId();
    const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: org, key: "linkedin_session" } } });
    const s = row?.value ? (JSON.parse(row.value) as { state?: string; since?: string }) : null;
    if (s?.state !== "signed_out") return null;
    const since = s.since ? new Date(s.since).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
    return { level: "critical", text: `LinkedIn is signed out in the collecting browser${since ? ` since ${since} ET` : ""} — sign back in or nothing is collected.` };
  } catch {
    return null;
  }
}

export type BriefResult = {
  day: string;
  subject: string;
  to: string;
  sent: boolean;
  skipped: string | null;
  sections: Array<{ id: string; ok: boolean; error?: string }>;
  status?: number;
  error?: string;
};

export async function buildDailyBrief(opts: { now?: Date } = {}) {
  const report = await buildDailyReport();
  const plans = await Promise.all(PARTS.map((p) => reportPlan(p.id, envFallback(p.id), opts.now)));
  const due = PARTS.filter((_, i) => plans[i].due);
  const to = Array.from(new Set(plans.filter((p) => p.due).flatMap((p) => p.to))).filter(Boolean);
  const results: BriefResult["sections"] = [];
  const sections: Section[] = [];
  for (const p of due) {
    try {
      const html = p.path ? await fetchSection(p.path) : renderDailyReportHtml(report);
      sections.push({ id: p.id, title: p.title, html });
      results.push({ id: p.id, ok: true });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      results.push({ id: p.id, ok: false, error: err });
      sections.push({ id: p.id, title: p.title, html: `<p style="color:#b91c1c;">This section could not be built today (${err}). <a href="${SITE}${p.path}">Open it on the site</a>.</p>` });
    }
  }
  const alerts: Alert[] = [];
  if (report.status.level !== "ok") alerts.push({ level: report.status.level, text: report.status.headline });
  if (report.extension.level !== "ok") alerts.push({ level: report.extension.level, text: report.extension.headline });
  const li = await linkedInAlert();
  if (li) alerts.push(li);
  const posts = report.metrics.find((m) => m.key === "posts")?.yesterday ?? 0;
  const companies = report.metrics.find((m) => m.key === "companies")?.yesterday ?? 0;
  const subject = dailyBriefSubject({
    day: report.day.short,
    workspace: workspaceLabel(undefined),
    collectionLevel: report.status.level,
    extensionCritical: report.extension.level === "critical",
    alerts: alerts.length,
    tail: postsFromCompanies(posts ?? 0, companies ?? 0),
  });
  const html = combineEmail({
    title: `Daily brief — ${report.day.label}`,
    subtitle: `One email for Collection, Posting, Competitive, Intelligence and Digest · ${posts ?? 0} posts from ${companies ?? 0} companies`,
    alerts,
    sections,
    footer: `social.gershon.ai · who gets this and which sections: Settings → Reports. Setting <code>report_bundling</code> = off brings back the separate emails.`,
  });
  return { day: report.day.key, subject, html, to: to.length ? to : [DEFAULT_REPORT_TO], sections: results };
}

export async function sendDailyBrief(opts: { force?: boolean; to?: string } = {}): Promise<BriefResult> {
  const b = await buildDailyBrief();
  const to = opts.to ? opts.to.split(/\s*,\s*/).filter(Boolean) : b.to;
  const base = { day: b.day, subject: b.subject, to: to.join(", "), sections: b.sections };
  if (!b.sections.length) return { ...base, sent: false, skipped: "every section is off today (Settings → Reports)" };
  if (!opts.force && !opts.to) {
    const s = await readSent();
    if (s[b.day]) return { ...base, sent: false, skipped: `already sent (${s[b.day]})` };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ...base, sent: false, skipped: null, error: "RESEND_API_KEY not set" };
  const from = withGcName(process.env.OPS_REPORT_FROM || OPS_FROM);
  const r = await sendResend(apiKey, withAuditBcc({ from, to, subject: b.subject, html: b.html }), {
    idempotencyKey: opts.force || opts.to ? undefined : `social-daily-brief-${b.day}`,
    label: "daily-brief",
  });
  if (r.ok && !opts.to) await markSent(b.day, `→ ${to.join(", ")}`).catch(() => undefined);
  return { ...base, sent: r.ok, skipped: null, status: r.status, error: r.ok ? undefined : (r.error || r.text || "").slice(0, 300) };
}
