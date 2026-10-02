/**
 * Monthly report — build and deliver.
 *
 *   • one report per client category (Campaigns, Clients, Partners, …) → GC report inbox
 *     (Campaigns also → sales@, the audience of the older campaign report)
 *   • one report per CAMPAIGN company → its registered user(s) / report email, Bcc report@
 *
 * Each email carries the full report in the body AND the same one-page PDF as
 * an attachment (the Linalysis pattern). Idempotent PER ITEM in
 * settings.monthly_report_sent, so a retry only sends what is still missing
 * and nobody ever gets the same month twice.
 */
import prisma from "@/lib/db";
import { categoryModel, companyModel, type CategoryModel, type CompanyModel, type MonthWindow } from "./model";
import { categoryPdf, companyPdf } from "./render-pdf";
import { categoryHtml, categorySubject, companyHtml, companySubject } from "./render-html";
import { loadCategories, loadCompanyExtras, monthWindow, primaryOrgId } from "./data";
import { APP_VERSION } from "@/lib/extension-version";
import { competitionHtml, competitionModel, competitionPdf, competitionSubject, type CompetitionModel } from "./competition";

export const MONTHLY_SENT_KEY = "monthly_report_sent";
const REPORT_INBOX = "report@gershonconsulting.com";
const SALES_INBOX = "sales@gershonconsulting.com";
// Sender naming rule: Gershon-internal reports carry the "GC" prefix; the
// client-facing one keeps the product name. gershon.ai is the only verified domain.
const FROM_INTERNAL = "GC Social <reports@gershon.ai>";
const FROM_CLIENT = "Social · Gershon.AI <reports@gershon.ai>";

export function buildLabel(): string {
  const sha = (process.env.NEXT_PUBLIC_APP_VERSION || "").slice(0, 7);
  return [`Social v${APP_VERSION}`, sha].filter(Boolean).join(" · ");
}

type Sent = Record<string, Record<string, string>>;
async function readSent(): Promise<Sent> {
  const row = await prisma.setting.findUnique({ where: { key: MONTHLY_SENT_KEY } });
  try { const v = JSON.parse(row?.value || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
async function markSent(month: string, item: string, note: string) {
  const s = await readSent();
  s[month] = s[month] || {};
  s[month][item] = `${new Date().toISOString()} ${note}`;
  const keys = Object.keys(s).sort();
  while (keys.length > 13) delete s[keys.shift() as string];
  const value = JSON.stringify(s);
  await prisma.setting.upsert({ where: { key: MONTHLY_SENT_KEY }, update: { value }, create: { key: MONTHLY_SENT_KEY, value } });
}

async function resend(msg: { from: string; to: string[]; bcc?: string[]; subject: string; html: string; filename: string; pdf: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from: msg.from, to: msg.to, bcc: msg.bcc?.length ? msg.bcc : undefined, subject: msg.subject, html: msg.html,
        attachments: [{ filename: msg.filename, content: msg.pdf }],
      }),
    });
    const body = await r.text().catch(() => "");
    return r.ok ? { ok: true, id: (body.match(/"id"\s*:\s*"([^"]+)"/) || [])[1] } : { ok: false, status: r.status, error: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface MonthlyBuild {
  win: MonthWindow;
  categories: Array<CategoryModel | CompetitionModel>;
  companies: Array<{ model: CompanyModel; recipients: string[] }>;
}

/** Build every model for a month (no sending). */
export async function buildMonthly(month?: string | null): Promise<MonthlyBuild> {
  const win = monthWindow(month);
  const orgId = await primaryOrgId();
  const cats = await loadCategories(win, orgId);
  const companies: MonthlyBuild["companies"] = [];
  for (const cat of cats.filter((c) => c.perCompany)) {
    for (const c of cat.companies) {
      if (!(c.li + c.x)) continue;
      const extras = await loadCompanyExtras(win, orgId, c);
      const model = companyModel(win, c, extras);
      if (model) companies.push({ model, recipients: extras.recipients });
    }
    cat.delivered = companies.filter((x) => x.recipients.length && cat.companies.some((c) => c.id === x.model.id)).map((x) => x.model.name);
  }
  // Competition gets its own learning report; every other category the standard one.
  const categories = cats
    .map((c) => (c.key === "COMPETITION" ? competitionModel(win, c) : categoryModel(win, c)))
    .filter((m): m is CategoryModel | CompetitionModel => !!m);
  return { win, categories, companies };
}

export function renderCategory(b: MonthlyBuild, m: CategoryModel | CompetitionModel) {
  const build = buildLabel();
  if (m.kind === "competition") {
    return { subject: competitionSubject(b.win, m), html: competitionHtml(b.win, m, build), pdf: competitionPdf(b.win, m, build), filename: `social-${b.win.key}-competition.pdf` };
  }
  return { subject: categorySubject(b.win, m), html: categoryHtml(b.win, m, build), pdf: categoryPdf(b.win, m, build), filename: `social-${b.win.key}-${slug(m.label)}.pdf` };
}
export function renderCompany(b: MonthlyBuild, m: CompanyModel, to: string) {
  const build = buildLabel();
  return { subject: companySubject(b.win, m), html: companyHtml(b.win, m, build, to), pdf: companyPdf(b.win, m, build), filename: `social-${b.win.key}-${slug(m.name)}.pdf` };
}

export interface MonthlyRunResult {
  month: string;
  results: Array<{ item: string; to?: string[]; ok?: boolean; skipped?: string; error?: string; id?: string }>;
}

export async function runMonthlyReports(opts: { month?: string | null; force?: boolean; dry?: boolean } = {}): Promise<MonthlyRunResult> {
  const b = await buildMonthly(opts.month);
  const sent = opts.force ? {} : (await readSent())[b.win.key] || {};
  const out: MonthlyRunResult = { month: b.win.key, results: [] };

  // 1. Each campaign company's own report first, so the category report can
  //    say who received theirs.
  for (const c of b.companies) {
    const item = `co:${c.model.id}`;
    if (!c.recipients.length) { out.results.push({ item: c.model.name, skipped: "no report email on file" }); continue; }
    if (sent[item]) { out.results.push({ item: c.model.name, skipped: `already sent ${sent[item]}` }); continue; }
    const r = renderCompany(b, c.model, c.recipients.join(", "));
    if (opts.dry) { out.results.push({ item: c.model.name, to: c.recipients, ok: true, skipped: "dry run" }); continue; }
    const s = await resend({ from: FROM_CLIENT, to: c.recipients, bcc: [REPORT_INBOX], subject: r.subject, html: r.html, filename: r.filename, pdf: r.pdf.base64() });
    out.results.push({ item: c.model.name, to: c.recipients, ...s });
    if (s.ok) await markSent(b.win.key, item, c.recipients.join(","));
    await pause(700);
  }

  // 2. One report per category.
  for (const m of b.categories) {
    const item = `cat:${m.key}`;
    if (sent[item]) { out.results.push({ item: m.label, skipped: `already sent ${sent[item]}` }); continue; }
    const to = m.key === "CAMPAIGN" ? [REPORT_INBOX, SALES_INBOX] : [REPORT_INBOX];
    const r = renderCategory(b, m);
    if (opts.dry) { out.results.push({ item: m.label, to, ok: true, skipped: "dry run" }); continue; }
    const s = await resend({ from: FROM_INTERNAL, to, subject: r.subject, html: r.html, filename: r.filename, pdf: r.pdf.base64() });
    out.results.push({ item: m.label, to, ...s });
    if (s.ok) await markSent(b.win.key, item, to.join(","));
    await pause(700);
  }
  return out;
}
