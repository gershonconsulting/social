/**
 * Friday client pack (v4.82.0) — ONE email per Friday instead of 3 per client (42 for 14 clients).
 *
 * friday-reports.yml still POSTs /api/report/friday?client=<id> once per client
 * (one Worker request each, so the subrequest budget is per client). Each call
 * now STAGES that client's row in Setting `friday_pack:<report Friday>`; the call
 * that completes the list sends the pack. The daily digest flushes a pack that is
 * still unsent the day after (a client that failed to stage never blocks it).
 */
import rawDb from "@/lib/db-raw";
import { withAuditBcc } from "@/lib/mail-bcc";
import { sendResend } from "@/lib/resend-send";
import { withGcName } from "@/lib/email/sender";
import { OPS_FROM, SITE } from "../ops/shell";
import { listFridayClients, loadFridayData, weekLabelOf } from "../friday/data";
import { fridayReportDay, fridayWeekFor } from "../friday/once";
import { fridayRecipients } from "../friday/send";
import { etDayKey } from "../et-days";
import { fridayPackHtml, packEntryFrom, type PackEntry } from "./combine";

type Stored = { entries: Record<string, PackEntry>; sentAt?: string; to?: string };
const keyOf = (day: string) => `friday_pack:${day}`;

async function read(day: string): Promise<Stored> {
  const row = await rawDb.setting.findUnique({ where: { key: keyOf(day) } }).catch(() => null);
  try {
    const v = row?.value ? JSON.parse(row.value) : null;
    return v && typeof v === "object" && v.entries ? v : { entries: {} };
  } catch {
    return { entries: {} };
  }
}
async function write(day: string, s: Stored) {
  const value = JSON.stringify(s);
  await rawDb.setting.upsert({ where: { key: keyOf(day) }, update: { value }, create: { key: keyOf(day), value } });
}

export type PackResult = { day: string; staged: number; expected: number; sent: boolean; skipped?: string; to?: string; error?: string };

async function sendPack(day: string, s: Stored, opts: { force?: boolean; to?: string } = {}): Promise<PackResult> {
  const entries = Object.values(s.entries);
  const base = { day, staged: entries.length, expected: entries.length };
  if (!entries.length) return { ...base, sent: false, skipped: "nothing staged" };
  if (s.sentAt && !opts.force && !opts.to) return { ...base, sent: false, skipped: `already sent ${s.sentAt}` };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ...base, sent: false, error: "RESEND_API_KEY not set" };
  const to = opts.to ? opts.to.split(",").map((x) => x.trim()).filter(Boolean) : await fridayRecipients();
  const weekLabel = weekLabelOf(fridayWeekFor(day));
  const html = fridayPackHtml({ weekLabel, entries, site: SITE });
  const subject = `Social.gershon.ai — Friday client pack — ${entries.length} clients — week of ${weekLabel}`;
  const r = await sendResend(apiKey, withAuditBcc({ from: withGcName(process.env.OPS_REPORT_FROM || OPS_FROM), to, subject, html }), {
    idempotencyKey: opts.force || opts.to ? undefined : `social-friday-pack-${day}`,
    label: "friday-pack",
  });
  if (r.ok && !opts.to) await write(day, { ...s, sentAt: new Date().toISOString(), to: to.join(", ") }).catch(() => undefined);
  return { ...base, sent: r.ok, to: to.join(", "), error: r.ok ? undefined : (r.error || r.text || "").slice(0, 300) };
}

/** Stage one client; send the pack when every Friday client is in. */
export async function stageFridayClient(orgId: string, clientId: string, opts: { force?: boolean } = {}): Promise<PackResult> {
  const day = fridayReportDay();
  const data = await loadFridayData(orgId, clientId);
  const s = await read(day);
  s.entries[clientId] = packEntryFrom(data, SITE);
  await write(day, s);
  const expected = (await listFridayClients(orgId)).map((c) => c.id);
  const missing = expected.filter((id) => !s.entries[id]);
  if (missing.length && !opts.force) return { day, staged: Object.keys(s.entries).length, expected: expected.length, sent: false, skipped: `waiting for ${missing.length} more client(s)` };
  const r = await sendPack(day, s, opts);
  return { ...r, expected: expected.length };
}

/** Send what is staged (manual ?flush=1, or the day-after safety net from the digest). */
export async function flushFridayPack(opts: { force?: boolean; to?: string; onlyIfLate?: boolean } = {}): Promise<PackResult> {
  const day = fridayReportDay();
  const s = await read(day);
  if (opts.onlyIfLate && etDayKey(0) === day) return { day, staged: Object.keys(s.entries).length, expected: 0, sent: false, skipped: "report Friday not over yet" };
  return sendPack(day, s, opts);
}
