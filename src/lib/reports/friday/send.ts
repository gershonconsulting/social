/**
 * Friday client reports (v4.78.0) — build and send the three e-mails for one client.
 *
 * Olivier, 2026-11-10: client reports are reviewed before any client sees them,
 * so the pack goes to Gershon (Setting `friday_reports_to`, default
 * olivier@gershonconsulting.com), never to the client. Each e-mail is sent once
 * per client per report day (Setting `friday_reports_sent`), so retries are safe.
 * Scheduled by .github/workflows/friday-reports.yml (Fridays 14:00 ET).
 */
import rawDb from "@/lib/db-raw";
import { withAuditBcc } from "@/lib/mail-bcc";
import { withGcName } from "@/lib/email/sender";
import { OPS_FROM } from "../ops/shell";
import { loadFridayData, type FridayData } from "./data";
import { buildFridayIntel } from "./intel";
import { FRIDAY_KINDS, fridaySubject, renderCompany, renderCompetitive, renderIntelligence, type FridayKind } from "./render";

export const FRIDAY_TO_DEFAULT = "olivier@gershonconsulting.com";
const TO_KEY = "friday_reports_to";
const SENT_KEY = "friday_reports_sent";

export type FridayEmail = { kind: FridayKind; subject: string; html: string };

export async function buildFridayPack(orgId: string, clientId: string, opts: { refresh?: boolean; kinds?: FridayKind[] } = {}): Promise<{ data: FridayData; emails: FridayEmail[] }> {
  const data = await loadFridayData(orgId, clientId);
  const kinds = opts.kinds || FRIDAY_KINDS;
  const emails: FridayEmail[] = [];
  for (const kind of kinds) {
    let html: string;
    if (kind === "company") html = renderCompany(data);
    else if (kind === "competitive") html = renderCompetitive(data);
    else html = renderIntelligence(data, await buildFridayIntel(data, opts));
    emails.push({ kind, subject: fridaySubject(kind, data), html });
  }
  return { data, emails };
}

export async function fridayRecipients(): Promise<string[]> {
  const row = await rawDb.setting.findUnique({ where: { key: TO_KEY } }).catch(() => null);
  const raw = row?.value?.trim() || process.env.FRIDAY_REPORT_TO || FRIDAY_TO_DEFAULT;
  return raw.split(",").map((x) => x.trim()).filter((x) => /@/.test(x));
}

async function readSent(): Promise<Record<string, string>> {
  const row = await rawDb.setting.findUnique({ where: { key: SENT_KEY } }).catch(() => null);
  try {
    const v = row?.value ? JSON.parse(row.value) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
async function markSent(id: string, note: string): Promise<void> {
  const sent = await readSent();
  sent[id] = `${new Date().toISOString()} ${note}`;
  const keys = Object.keys(sent).sort((a, b) => (sent[a] < sent[b] ? -1 : 1));
  while (keys.length > 400) delete sent[keys.shift() as string];
  const value = JSON.stringify(sent);
  await rawDb.setting.upsert({ where: { key: SENT_KEY }, update: { value }, create: { key: SENT_KEY, value } });
}

export type FridayResult = { client: string; kind: FridayKind; subject: string; to: string; sent: boolean; skipped?: string; error?: string };

export async function sendFridayPack(orgId: string, clientId: string, opts: { force?: boolean; to?: string } = {}): Promise<FridayResult[]> {
  const { data, emails } = await buildFridayPack(orgId, clientId);
  const to = opts.to ? opts.to.split(",").map((x) => x.trim()).filter(Boolean) : await fridayRecipients();
  const sent = opts.force ? {} : await readSent();
  const apiKey = process.env.RESEND_API_KEY;
  const out: FridayResult[] = [];
  for (const e of emails) {
    const id = `${e.kind}:${clientId}:${data.dayKey}`;
    const base = { client: data.client.name, kind: e.kind, subject: e.subject, to: to.join(", ") };
    if (sent[id] && !opts.to) {
      out.push({ ...base, sent: false, skipped: `already sent (${sent[id]})` });
      continue;
    }
    if (!apiKey) {
      out.push({ ...base, sent: false, error: "RESEND_API_KEY not set" });
      continue;
    }
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(withAuditBcc({ from: withGcName(process.env.OPS_REPORT_FROM || OPS_FROM), to, subject: e.subject, html: e.html })),
      });
      if (!r.ok) {
        out.push({ ...base, sent: false, error: `Resend ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}` });
        continue;
      }
      if (!opts.to) await markSent(id, `→ ${to.join(", ")}`).catch(() => undefined);
      out.push({ ...base, sent: true });
    } catch (err) {
      out.push({ ...base, sent: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
