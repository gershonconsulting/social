/**
 * Shared frame for the four daily operations reports (v4.49.0).
 *
 * Olivier, 2026-10-16: "4 different emails all going to report@".
 *
 *   1. Collection   — is the Chrome extension doing its job (the existing
 *                     /api/report/daily, retitled "Social Collection Report").
 *   2. Posting      — did every campaign / internal company get its post?
 *   3. Content      — how much approved content is ready, per company.
 *   4. Competitive  — what we collected from competitors and partners, per
 *                     day and per week, and what kind of content it is.
 *
 * Every report is a feature of the app: built and sent by
 * /api/report/ops (and chained from the daily report cron), never by a
 * Claude scheduled task. Inline CSS only — Gmail strips <style> blocks.
 */

import prisma from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { APP_VERSION } from "@/lib/extension-version";
import { BUSINESS_TZ } from "../et-days";
import { withAuditBcc } from "@/lib/mail-bcc";

export const RED = "#FE1B04";
export const GREEN = "#047857";
export const AMBER = "#b45309";
export const DARK_RED = "#b91c1c";
export const GREY = "#6b7280";
export const SITE = siteUrl();

/** "GC" prefix on the from-name: Gershon-internal report (sender naming rule). */
export const OPS_FROM = "GC Social <reports@gershon.ai>";
export const OPS_TO = "report@gershonconsulting.com";
const SENT_KEY = "ops_reports_sent";

export type Level = "ok" | "warn" | "critical";
export const LEVEL_COLOR: Record<Level, string> = { ok: GREEN, warn: AMBER, critical: DARK_RED };

export const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1));

/** The ET calendar day ("YYYY-MM-DD") an instant falls on. */
export function etKeyOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "Thu 15" for a "YYYY-MM-DD" key. */
export function shortDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
}

export function isWeekend(key: string): boolean {
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

export function pill(text: string, level: Level): string {
  const c = LEVEL_COLOR[level];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;color:#fff;background:${c};white-space:nowrap;">${esc(text)}</span>`;
}

export function banner(level: Level, headline: string, detail: string): string {
  const bg = level === "critical" ? "#7f1d1d" : level === "warn" ? "#fffbeb" : "#ecfdf5";
  const fg = level === "critical" ? "#fff" : level === "warn" ? "#78350f" : "#064e3b";
  const icon = level === "critical" ? "⛔" : level === "warn" ? "⚠️" : "✅";
  return `<div style="background:${bg};color:${fg};padding:18px 24px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:18px;font-weight:800;">${icon} ${esc(headline)}</div>
    ${detail ? `<div style="font-size:13px;margin-top:6px;line-height:1.5;">${detail}</div>` : ""}
  </div>`;
}

export function kpis(items: Array<{ label: string; value: string; hint?: string; level?: Level }>): string {
  const cells = items
    .map(
      (k) => `<td style="padding:14px 10px;text-align:center;border-right:1px solid #eee;vertical-align:top;">
      <div style="font-size:26px;font-weight:800;color:${k.level ? LEVEL_COLOR[k.level] : "#111"};">${esc(k.value)}</div>
      <div style="font-size:12px;font-weight:600;color:#111;margin-top:2px;">${esc(k.label)}</div>
      ${k.hint ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${esc(k.hint)}</div>` : ""}
    </td>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:1px solid #eee;"><tr>${cells}</tr></table>`;
}

export function section(title: string, body: string, note?: string): string {
  return `<div style="padding:18px 24px;border-bottom:1px solid #eee;">
    <div style="font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${RED};">${esc(title)}</div>
    ${note ? `<div style="font-size:12px;color:${GREY};margin-top:4px;">${note}</div>` : ""}
    <div style="margin-top:10px;">${body}</div>
  </div>`;
}

export const TH = `style="padding:7px 8px;text-align:left;font-size:11px;color:${GREY};font-weight:700;border-bottom:2px solid #eee;white-space:nowrap;"`;
export const THR = `style="padding:7px 8px;text-align:right;font-size:11px;color:${GREY};font-weight:700;border-bottom:2px solid #eee;white-space:nowrap;"`;
export const TD = `style="padding:7px 8px;font-size:13px;border-bottom:1px solid #f1f1f1;vertical-align:top;"`;
export const TDR = `style="padding:7px 8px;font-size:13px;border-bottom:1px solid #f1f1f1;text-align:right;vertical-align:top;white-space:nowrap;"`;

export function table(head: string, rows: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${head}${rows}</table>`;
}

export type OpsKind = "posting" | "content" | "competitive" | "intelligence";
export const OPS_LABEL: Record<OpsKind | "collection", string> = {
  collection: "Collection",
  posting: "Posting",
  content: "Content Ready",
  competitive: "Competitive",
  intelligence: "Intelligence",
};

/** The four reports link to each other so any one of them opens the rest. */
function siblings(current: OpsKind | "collection"): string {
  const links: Array<[OpsKind | "collection", string]> = [
    ["collection", `${SITE}/api/report/daily`],
    ["posting", `${SITE}/api/report/ops?kind=posting`],
    ["content", `${SITE}/api/report/ops?kind=content`],
    ["competitive", `${SITE}/api/report/ops?kind=competitive`],
    ["intelligence", `${SITE}/api/report/ops?kind=intelligence`],
  ];
  return links
    .map(([k, href]) =>
      k === current
        ? `<b style="color:#fff;">${OPS_LABEL[k]}</b>`
        : `<a href="${href}" style="color:#d1d5db;text-decoration:none;">${OPS_LABEL[k]}</a>`,
    )
    .join(` <span style="color:#6b7280;">·</span> `);
}

export function page(opts: {
  kind: OpsKind;
  title: string;
  subtitle: string;
  body: string;
  cta: { href: string; label: string };
}): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111;">
<div style="max-width:720px;margin:0 auto;background:#fff;">
  <div style="background:#111;padding:20px 24px;border-bottom:4px solid ${RED};">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af;">GC Social · daily report</div>
    <div style="font-size:22px;font-weight:800;color:#fff;margin-top:4px;">${esc(opts.title)}</div>
    <div style="font-size:13px;color:#d1d5db;margin-top:4px;">${esc(opts.subtitle)}</div>
    <div style="font-size:12px;margin-top:10px;">${siblings(opts.kind)}</div>
  </div>
  ${opts.body}
  <div style="padding:16px 24px;background:#111;text-align:center;">
    <a href="${opts.cta.href}" style="display:inline-block;padding:11px 22px;background:${RED};color:#fff;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;">${esc(opts.cta.label)} →</a>
  </div>
  <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">
    Built and sent by ${esc(SITE.replace(/^https?:\/\//, ""))} on ${esc(new Date().toLocaleString("en-US", { timeZone: BUSINESS_TZ, dateStyle: "medium", timeStyle: "short" }))} ET · app v${APP_VERSION}
  </div>
</div></body></html>`;
}

// ── Delivery ────────────────────────────────────────────────────────────────

async function readSent(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: SENT_KEY } });
  if (!row?.value) return {};
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

async function markSent(id: string, note: string): Promise<void> {
  const sent = await readSent();
  sent[id] = `${new Date().toISOString()} ${note}`;
  const keys = Object.keys(sent).sort((a, b) => (sent[a] < sent[b] ? -1 : 1));
  while (keys.length > 120) delete sent[keys.shift() as string];
  const value = JSON.stringify(sent);
  await prisma.setting.upsert({ where: { key: SENT_KEY }, update: { value }, create: { key: SENT_KEY, value } });
}

export type DeliveryResult = { kind: OpsKind; subject: string; to: string; sent: boolean; skipped: string | null; status?: number; error?: string };

/** Send one report once per ET day (idempotent: retries and double crons are no-ops). */
export async function deliver(
  kind: OpsKind,
  dayKey: string,
  subject: string,
  html: string,
  opts: { force?: boolean; to?: string; defaultTo?: string } = {},
): Promise<DeliveryResult> {
  const to = opts.to || opts.defaultTo || process.env.REPORT_TO || OPS_TO;
  const id = `${kind}:${dayKey}`;
  if (!opts.force) {
    const sent = await readSent();
    if (sent[id]) return { kind, subject, to, sent: false, skipped: `already sent (${sent[id]})` };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { kind, subject, to, sent: false, skipped: null, error: "RESEND_API_KEY not set" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withAuditBcc({ from: process.env.OPS_REPORT_FROM || OPS_FROM, to: [to], subject, html })),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { kind, subject, to, sent: false, skipped: null, status: r.status, error: body.slice(0, 300) };
    }
    try {
      await markSent(id, `→ ${to}`);
    } catch {
      /* mail is out; bookkeeping must not fail the send */
    }
    return { kind, subject, to, sent: true, skipped: null, status: r.status };
  } catch (e) {
    return { kind, subject, to, sent: false, skipped: null, error: e instanceof Error ? e.message : String(e) };
  }
}
