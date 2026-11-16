/**
 * Friday client reports (v4.78.0) — build and send the three e-mails for one client.
 *
 * Olivier, 2026-11-10: client reports are reviewed before any client sees them,
 * so the pack goes to Gershon (Setting `friday_reports_to`, default
 * olivier@gershonconsulting.com), never to the client. Each e-mail is sent once
 * per client per REPORT FRIDAY (v4.78.5: Setting `friday_reports_sent` keyed on
 * the report Friday, not on the ET day the job ran, plus a Resend
 * Idempotency-Key — see ./once.ts), so late crons, catch-up runs and retries are safe.
 * Scheduled by .github/workflows/friday-reports.yml (Fridays 14:00 ET).
 */
import rawDb from "@/lib/db-raw";
import { withAuditBcc } from "@/lib/mail-bcc";
import { sendResend } from "@/lib/resend-send";
import { withGcName } from "@/lib/email/sender";
import { OPS_FROM } from "../ops/shell";
import { loadFridayData, type FridayData } from "./data";
import { buildFridayIntel } from "./intel";
import { sendOncePerReportDay } from "./once";
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
  const base = { client: data.client.name, to: to.join(", ") };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return emails.map((e) => ({ ...base, kind: e.kind, subject: e.subject, sent: false, error: "RESEND_API_KEY not set" }));
  const from = withGcName(process.env.OPS_REPORT_FROM || OPS_FROM);
  const results = await sendOncePerReportDay(
    clientId,
    data.dayKey,
    emails,
    {
      post: async (e, idempotencyKey) => {
        // v4.78.6: retries 429/5xx/network 3x with the same Idempotency-Key (lib/resend-send.ts).
        // A 409 for an already-used key is not retried, so once.ts still sees it as "already sent".
        const r = await sendResend(apiKey, withAuditBcc({ from, to, subject: e.subject, html: e.html }), {
          idempotencyKey: idempotencyKey || undefined,
          label: `friday-${e.kind}`,
        });
        return { status: r.status, text: r.ok ? "" : r.text || r.error || "" };
      },
      readSent,
      markSent: (key) => markSent(key, `→ ${to.join(", ")}`),
    },
    { force: opts.force, testOnly: !!opts.to },
  );
  return results.map((r) => ({ ...base, ...r }));
}
