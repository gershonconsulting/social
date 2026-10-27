/**
 * [19] "Social — still missing today" (v4.64.0, 2026-10-26).
 *
 * Replaces the Claude scheduled task #19 "Social daily cloud scrape". The
 * scraping is gone for good — LinkedIn and X block cloud IPs — so what is left
 * is the useful part: at ~09:00 New York, list every (client, platform) pair
 * that has an ENABLED connection but no post ingested today (America/New_York
 * day, same rule as GET /api/admin/daily-collection-status), and email that
 * list to social@gershonconsulting.com. Nothing is sent when the list is empty.
 *
 * Each missing line is classified:
 *   ❌ unresolvable — the link cannot work: no URL/handle on the connection,
 *      or the last collection said the page does not exist / opens another
 *      company's page (PAGE_UNAVAILABLE / PAGE_MISMATCH / 404-type errors).
 *   🔒 blocked     — the link looks fine; today's collection just did not get
 *      through (login wall, rate limit, extension not run yet...).
 *
 * Idempotent per New York day (Setting "missing_today_sent").
 */
import prisma from "@/lib/db";
import { ClientStatus, Platform } from "@prisma/client";
import { PAGE_MISMATCH, PAGE_UNAVAILABLE } from "@/lib/linkedin-page-check";
import { withAuditBcc } from "@/lib/mail-bcc";

export const MISSING_SENT_KEY = "missing_today_sent";
export const MISSING_DEFAULT_TO = "social@gershonconsulting.com";
export const MISSING_DEFAULT_FROM = "GC Social <reports@gershon.ai>";
const PLATFORMS: Platform[] = [Platform.LINKEDIN, Platform.TWITTER];
const KEEP_KEYS = 30;

export interface MissingLine {
  clientId: string;
  clientName: string;
  platform: "LINKEDIN" | "TWITTER";
  url: string | null;
  kind: "unresolvable" | "blocked";
  reason: string;
  lastSyncAt: string | null;
}

export interface MissingToday {
  day: string; // YYYY-MM-DD, America/New_York
  checked: number; // enabled (client, platform) pairs looked at
  missing: MissingLine[];
}

export function nyDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function nyHour(d: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(d),
  ) % 24;
}

const NOT_FOUND_RE = /\b(404|not found|does ?n[o']t exist|no longer exists|page unavailable|unavailable|invalid (url|handle|profile)|no such (user|page|account)|account suspended|suspended)\b/i;

function classify(url: string | null, handle: string | null, err: string): { kind: MissingLine["kind"]; reason: string } {
  if (!url && !handle) return { kind: "unresolvable", reason: "No page URL or handle on this connection." };
  if (err.startsWith(PAGE_UNAVAILABLE)) return { kind: "unresolvable", reason: "The page does not exist at this link." };
  if (err.startsWith(PAGE_MISMATCH)) {
    return {
      kind: "unresolvable",
      reason: err.replace(/^PAGE_MISMATCH:\s*/, "").replace(/^the link opens/, "The link opens") + ".",
    };
  }
  if (err && NOT_FOUND_RE.test(err)) return { kind: "unresolvable", reason: err.slice(0, 200) };
  return {
    kind: "blocked",
    reason: err ? `Blocked: ${err.slice(0, 160)}` : "No post collected yet today (collection blocked or not run).",
  };
}

export async function buildMissingToday(): Promise<MissingToday> {
  const day = nyDay();
  const [clients, connections, posts] = await Promise.all([
    prisma.client.findMany({
      where: { status: ClientStatus.ACTIVE },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.platformConnection.findMany({
      where: { isEnabled: true, platform: { in: PLATFORMS } },
      select: {
        clientId: true, platform: true, externalAccountUrl: true, externalAccountId: true,
        lastSyncError: true, lastSyncAt: true,
      },
    }),
    prisma.socialPost.findMany({
      where: { publishedDateLocal: day, platform: { in: PLATFORMS } },
      select: { clientId: true, platform: true },
    }),
  ]);

  const has = new Set(posts.map((p) => `${p.clientId}:${p.platform}`));
  const conn = new Map(connections.map((c) => [`${c.clientId}:${c.platform}`, c]));
  const missing: MissingLine[] = [];
  let checked = 0;
  for (const c of clients) {
    for (const plat of PLATFORMS) {
      const pc = conn.get(`${c.id}:${plat}`);
      if (!pc) continue; // not configured = not tracked, so not "missing"
      checked++;
      if (has.has(`${c.id}:${plat}`)) continue;
      const url = pc.externalAccountUrl?.trim() || null;
      const { kind, reason } = classify(url, pc.externalAccountId?.trim() || null, pc.lastSyncError ?? "");
      missing.push({
        clientId: c.id,
        clientName: c.name,
        platform: plat as MissingLine["platform"],
        url,
        kind,
        reason,
        lastSyncAt: pc.lastSyncAt?.toISOString() ?? null,
      });
    }
  }
  // Unresolvable first (they need a fix), then by client name.
  missing.sort((a, b) => (a.kind === b.kind ? a.clientName.localeCompare(b.clientName) : a.kind === "unresolvable" ? -1 : 1));
  return { day, checked, missing };
}

export function missingSubject(r: MissingToday): string {
  return `[19] Social — still missing today: ${r.missing.length} — ${r.day}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderMissingHtml(r: MissingToday): string {
  const unres = r.missing.filter((m) => m.kind === "unresolvable").length;
  const blocked = r.missing.length - unres;
  const rows = r.missing
    .map((m) => {
      const icon = m.kind === "unresolvable" ? "❌" : "🔒";
      const color = m.kind === "unresolvable" ? "#b91c1c" : "#92400e";
      const plat = m.platform === "TWITTER" ? "X" : "LinkedIn";
      const link = m.url
        ? `<a href="${esc(m.url)}" style="color:#2563eb;text-decoration:none;word-break:break-all;">${esc(m.url)}</a>`
        : `<span style="color:#9ca3af;">no link</span>`;
      return `<tr>
  <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:16px;vertical-align:top;">${icon}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#111827;vertical-align:top;">${esc(m.clientName)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;vertical-align:top;">${plat}</td>
  <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;vertical-align:top;"><div style="color:${color};">${esc(m.reason)}</div><div style="margin-top:2px;font-size:12px;">${link}</div></td>
</tr>`;
    })
    .join("\n");
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="max-width:720px;margin:0 auto;padding:24px;background:#ffffff;">
  <div style="font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#c8102e;">GC Social · [19]</div>
  <h1 style="margin:6px 0 4px;font-size:22px;color:#111827;">Still missing today: ${r.missing.length}</h1>
  <div style="font-size:14px;color:#6b7280;margin-bottom:16px;">${esc(r.day)} (New York) · ${r.checked} tracked client/platform pairs checked · ❌ ${unres} link to fix · 🔒 ${blocked} blocked</div>
  <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;">
    <tr style="background:#f9fafb;">
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;"></th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;">Client</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;">Platform</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;color:#6b7280;">Why</th>
    </tr>
${rows}
  </table>
  <div style="margin-top:16px;font-size:12px;color:#6b7280;line-height:1.5;">
    ❌ = the page URL cannot be resolved or does not exist — fix the link in Social.<br>
    🔒 = the link is fine; today's collection was blocked or has not run — the Chrome extension will pick it up.<br>
    Sent by social.gershon.ai (/api/report/missing-today) every day ~09:00 New York; nothing is sent when nothing is missing.
  </div>
</div></body></html>`;
}

async function readSent(): Promise<Record<string, string>> {
  const row = await prisma.setting.findUnique({ where: { key: MISSING_SENT_KEY } });
  if (!row?.value) return {};
  try {
    const p = JSON.parse(row.value);
    return typeof p === "object" && p !== null ? p : {};
  } catch {
    return {};
  }
}

async function markSent(day: string, note: string): Promise<void> {
  const sent = await readSent();
  sent[day] = `${new Date().toISOString()} ${note}`;
  const keys = Object.keys(sent).sort();
  while (keys.length > KEEP_KEYS) {
    const k = keys.shift();
    if (k) delete sent[k];
  }
  const value = JSON.stringify(sent);
  await prisma.setting.upsert({ where: { key: MISSING_SENT_KEY }, update: { value }, create: { key: MISSING_SENT_KEY, value } });
}

export interface MissingSendResult {
  day: string;
  subject: string;
  count: number;
  sent: boolean;
  skipped: string | null;
  to: string;
  status?: number;
  id?: string;
  error?: string;
}

export async function sendMissingToday(opts: { force?: boolean; to?: string } = {}): Promise<MissingSendResult> {
  const r = await buildMissingToday();
  const subject = missingSubject(r);
  const to = opts.to || process.env.MISSING_REPORT_TO || MISSING_DEFAULT_TO;
  const base = { day: r.day, subject, count: r.missing.length, to };
  if (r.missing.length === 0) return { ...base, sent: false, skipped: "nothing missing — no email (N = 0)" };
  if (!opts.force) {
    const sent = await readSent();
    if (sent[r.day]) return { ...base, sent: false, skipped: `already sent (${sent[r.day]})` };
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ...base, sent: false, skipped: null, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withAuditBcc({ from: MISSING_DEFAULT_FROM, to, subject, html: renderMissingHtml(r) })),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) return { ...base, sent: false, skipped: null, status: res.status, error: body.slice(0, 400) };
    let id: string | undefined;
    try { id = JSON.parse(body)?.id; } catch {}
    try { await markSent(r.day, `→ ${to}${id ? ` (${id})` : ""}`); } catch { /* mail is out */ }
    return { ...base, sent: true, skipped: null, status: res.status, id };
  } catch (e) {
    return { ...base, sent: false, skipped: null, error: e instanceof Error ? e.message : String(e) };
  }
}
