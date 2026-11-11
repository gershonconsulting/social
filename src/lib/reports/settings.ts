/**
 * Report settings — one place for every email social.gershon.ai sends.
 *
 * Olivier, 2026-11-09: "We need in the settings a location for reports, who to
 * send the reports and how often. How many reports do we have already?"
 *
 * REPORT_CATALOG is the single list of every report / alert the app emails.
 * Settings → Reports shows it; each sender asks this file who to send to and
 * whether today is a send day. Nothing saved = the previous behaviour, so the
 * first deploy changes no recipient and no schedule.
 *
 * Stored in the global Setting row `report_settings` (no schema change):
 *   { "<reportId>": { "to": ["a@b.com"], "frequency": "weekly" }, … }
 *
 * Frequencies. A report can only run as often as the job that triggers it:
 *   daily-trigger reports  → daily | weekdays | weekly (Monday) | monthly (1st) | off
 *   weekly-trigger reports → weekly | off       (Friday job)
 *   monthly-trigger        → monthly | off      (1st of the month)
 *   event alerts           → on | off           (sent when the problem happens)
 * Day tests use the America/New_York calendar day, like every report here.
 */
import prisma from "@/lib/db";

export type Frequency = "daily" | "weekdays" | "weekly" | "monthly" | "on" | "off";
type Trigger = "daily" | "weekly" | "monthly" | "event";

export interface ReportDef {
  id: string;
  name: string;
  what: string;
  group: "Daily reports" | "Weekly & monthly reports" | "Alerts";
  trigger: Trigger;
  defaultTo: string[];
  defaultFrequency: Frequency;
  /** When the job fires, in plain words (New York time). */
  when: string;
  /** Extra note shown under the recipients (e.g. client copies). */
  note?: string;
  previewUrl?: string;
}

const REPORT = "report@gershonconsulting.com";
const SALES = "sales@gershonconsulting.com";
const SOCIAL = "social@gershonconsulting.com";
const AINA = "aina.rama@gershonconsulting.com";

export const REPORT_CATALOG: ReportDef[] = [
  { id: "collection", name: "Social Collection Report", group: "Daily reports", trigger: "daily", defaultTo: [REPORT], defaultFrequency: "daily", when: "8:00 am", what: "Yesterday's collection: posts collected, companies with new content, big warning if the collector did not run, Chrome extension version.", previewUrl: "/api/report/daily" },
  { id: "posting", name: "Social Posting Report", group: "Daily reports", trigger: "daily", defaultTo: [REPORT], defaultFrequency: "daily", when: "8:00 am", what: "Did every campaign / internal company post — day by day, with links to the content.", previewUrl: "/api/report/ops?kind=posting" },
  { id: "competitive", name: "Competitive Report", group: "Daily reports", trigger: "daily", defaultTo: [REPORT], defaultFrequency: "daily", when: "8:00 am", what: "Competitor and partner posts collected per day / week, their topics, and suggested actions.", previewUrl: "/api/report/ops?kind=competitive" },
  { id: "intelligence", name: "Social Intelligence Report", group: "Daily reports", trigger: "daily", defaultTo: [SALES], defaultFrequency: "daily", when: "8:00 am", what: "AI insights and actions from what competitors and partners post.", previewUrl: "/api/report/ops?kind=intelligence" },
  { id: "digest", name: "Daily Digest", group: "Daily reports", trigger: "daily", defaultTo: [REPORT, AINA], defaultFrequency: "daily", when: "9:00 am", what: "What was collected in the last 24 h, company by company, with the top posts.", previewUrl: "/api/digest/daily" },
  { id: "posting-alert-week", name: "Weekly posting alert", group: "Weekly & monthly reports", trigger: "weekly", defaultTo: [SOCIAL], defaultFrequency: "weekly", when: "Friday 5:00 pm", what: "Campaign companies that missed planned posting days this week. Silent when everyone hit every day.", previewUrl: "/api/cron/posting-alert?kind=week&preview=email" },
  { id: "posting-alert-month", name: "Monthly posting alert", group: "Weekly & monthly reports", trigger: "monthly", defaultTo: [SOCIAL], defaultFrequency: "monthly", when: "1st of the month, 5:00 pm", what: "Same check for the month that just closed.", previewUrl: "/api/cron/posting-alert?kind=month&preview=email" },
  { id: "monthly-category", name: "Monthly category reports", group: "Weekly & monthly reports", trigger: "monthly", defaultTo: [REPORT], defaultFrequency: "monthly", when: "1st of the month, 9:00 am", what: "One-page PDF per category (Campaigns, Clients, Partners, Prospects, Internal, Companies, Competition, Recycled).", note: "Campaigns also goes to sales@gershonconsulting.com.", previewUrl: "/api/report/monthly" },
  { id: "monthly-company", name: "Monthly report per campaign company", group: "Weekly & monthly reports", trigger: "monthly", defaultTo: [REPORT], defaultFrequency: "monthly", when: "1st of the month, 9:00 am", what: "Each campaign company's own one-page report, sent to the company's report email.", note: "Addresses here receive a copy (Bcc) of every company report. The client address is set per company." },
  { id: "health-check", name: "Collection stalled alert", group: "Alerts", trigger: "event", defaultTo: [REPORT], defaultFrequency: "on", when: "Checked daily 10:00 am", what: "Sent only when no post has been collected for 36 hours." },
  { id: "linkedin-signout", name: "LinkedIn signed out alert", group: "Alerts", trigger: "event", defaultTo: [REPORT], defaultFrequency: "on", when: "When it happens", what: "A browser running the extension was signed out of LinkedIn." },
];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: "Every day",
  weekdays: "Weekdays (Mon–Fri)",
  weekly: "Weekly",
  monthly: "Monthly",
  on: "On",
  off: "Off",
};

export function allowedFrequencies(def: ReportDef): Frequency[] {
  switch (def.trigger) {
    case "daily": return ["daily", "weekdays", "weekly", "monthly", "off"];
    case "weekly": return ["weekly", "off"];
    case "monthly": return ["monthly", "off"];
    default: return ["on", "off"];
  }
}

export function reportDef(id: string): ReportDef | undefined {
  return REPORT_CATALOG.find((r) => r.id === id);
}

export const REPORT_SETTINGS_KEY = "report_settings";
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface SavedReport { to?: string[]; frequency?: Frequency }
export type SavedReports = Record<string, SavedReport>;

export function cleanEmails(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.join(",") : String(v ?? "");
  const out: string[] = [];
  for (const p of raw.split(/[,;\s]+/)) {
    const e = p.trim().toLowerCase();
    if (e && EMAIL.test(e) && !out.includes(e)) out.push(e);
  }
  return out.slice(0, 20);
}

export async function readReportSettings(): Promise<SavedReports> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: REPORT_SETTINGS_KEY } });
    if (!row?.value) return {};
    const v = JSON.parse(row.value);
    return v && typeof v === "object" ? (v as SavedReports) : {};
  } catch {
    return {};
  }
}

export async function saveReportSettings(input: Record<string, { to?: unknown; frequency?: unknown }>): Promise<SavedReports> {
  const cur = await readReportSettings();
  for (const [id, patch] of Object.entries(input || {})) {
    const def = reportDef(id);
    if (!def || !patch) continue;
    const next: SavedReport = { ...cur[id] };
    if (patch.to !== undefined) {
      const to = cleanEmails(patch.to);
      if (!to.length) throw new Error(`${def.name}: at least one valid email is needed (set the frequency to Off to stop it).`);
      next.to = to;
    }
    if (patch.frequency !== undefined) {
      const f = String(patch.frequency) as Frequency;
      if (!allowedFrequencies(def).includes(f)) throw new Error(`${def.name}: "${f}" is not possible for this report.`);
      next.frequency = f;
    }
    cur[id] = next;
  }
  const value = JSON.stringify(cur);
  await prisma.setting.upsert({ where: { key: REPORT_SETTINGS_KEY }, update: { value }, create: { key: REPORT_SETTINGS_KEY, value } });
  return cur;
}

export interface ReportConfig { id: string; to: string[]; frequency: Frequency; custom: boolean }

/**
 * Who receives a report and how often. `fallbackTo` is the sender's own
 * previous answer (env override or hard default) — used until someone saves
 * recipients in Settings. Never throws: a settings read failure must not stop
 * a report.
 */
export async function reportConfig(id: string, fallbackTo?: string[] | string | null): Promise<ReportConfig> {
  const def = reportDef(id);
  const saved = (await readReportSettings())[id] || {};
  const fb = cleanEmails(fallbackTo ?? envFallback(id));
  const to = saved.to?.length ? saved.to : fb.length ? fb : def?.defaultTo || [];
  const frequency = saved.frequency || def?.defaultFrequency || "daily";
  return { id, to, frequency, custom: !!(saved.to?.length || saved.frequency) };
}

/** The America/New_York calendar day: weekday 0=Sun … 6=Sat and day of month. */
function nyDay(now: Date): { dow: number; dom: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", day: "numeric" }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const dom = Number(parts.find((p) => p.type === "day")?.value || "1");
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), dom };
}

/** Is today a send day for this frequency? (A daily job asks this every day.) */
export function isDueToday(frequency: Frequency, trigger: Trigger = "daily", now: Date = new Date()): boolean {
  if (frequency === "off") return false;
  if (trigger !== "daily") return true; // weekly / monthly / event jobs fire only on their own day
  const { dow, dom } = nyDay(now);
  switch (frequency) {
    case "weekdays": return dow >= 1 && dow <= 5;
    case "weekly": return dow === 1;
    case "monthly": return dom === 1;
    default: return true;
  }
}

/** One call for senders: recipients + whether to send today. */
export async function reportPlan(id: string, fallbackTo?: string[] | string | null, now: Date = new Date()) {
  const cfg = await reportConfig(id, fallbackTo);
  const def = reportDef(id);
  const due = isDueToday(cfg.frequency, def?.trigger || "daily", now);
  return { ...cfg, due, skipReason: due ? null : cfg.frequency === "off" ? "turned off in Settings → Reports" : `not a send day (${FREQUENCY_LABEL[cfg.frequency]} in Settings → Reports)` };
}

/**
 * Each sender's previous recipient logic (env override → hard default), kept
 * here so Settings shows exactly who receives a report today and the senders
 * use the same answer until someone saves recipients in Settings.
 */
export function envFallback(id: string): string[] {
  const env = (k: string) => (process.env[k] || "").trim();
  const legacy = (list: string[]) => list.filter((a) => a !== "oattia@gmail.com");
  switch (id) {
    case "collection":
    case "posting":
    case "competitive": return cleanEmails(env("REPORT_TO") || REPORT);
    case "intelligence": return cleanEmails(env("INTEL_REPORT_TO") || SALES);
    case "digest": { const l = legacy(cleanEmails(env("DIGEST_TO"))); return l.length ? l : [REPORT, AINA]; }
    case "posting-alert-week":
    case "posting-alert-month": return cleanEmails(env("POSTING_ALERT_TO") || SOCIAL);
    case "health-check": return cleanEmails(env("HEALTH_ALERT_TO") || env("DIGEST_TO") || "oattia@gmail.com");
    case "linkedin-signout": return cleanEmails(env("LINKEDIN_SIGNOUT_ALERT_TO") || REPORT);
    default: return reportDef(id)?.defaultTo || [];
  }
}
