/**
 * v4.47.0 — "Download PDF" on every company page (/clients/<id>).
 *
 * The monthly one-pager (render-pdf.ts companyPdf) used to exist only for
 * CAMPAIGN companies, inside the month-end email. This builds the same page
 * for ANY company we follow — campaigns, clients, partners, prospects,
 * competitors — for any month, including the month in progress (cut at today,
 * objective measured against the days that have passed).
 *
 * A month with no posts still downloads: a short, honest page saying nothing
 * was collected, rather than an error.
 */
import prisma from "@/lib/db";
import { companyModel, type CompanyModel, type MonthWindow } from "./model";
import { companyPdf } from "./render-pdf";
import { loadCompanyExtras, loadOneCompany, monthWindow, primaryOrgId } from "./data";
import { buildLabel } from "./send";
import { APP_VERSION } from "@/lib/extension-version";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pad = (n: number) => String(n).padStart(2, "0");

/** The current month (UTC) as YYYY-MM. */
export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
}

export class CompanyReportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function buildCompanyPdf(clientId: string, monthKey?: string | null, now = new Date()) {
  // Tenant-scoped read: a signed-in user only ever finds their own workspace's companies.
  const client = await prisma.client.findFirst({
    where: { id: clientId },
    select: { id: true, name: true, clientType: true, status: true, organizationId: true },
  });
  if (!client) throw new CompanyReportError(404, "Company not found");

  const thisMonth = currentMonthKey(now);
  const key = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : thisMonth;
  if (key > thisMonth) throw new CompanyReportError(400, "That month has not started yet");

  const win: MonthWindow = monthWindow(key, now);
  const inProgress = key === thisMonth;
  const today = now.getUTCDate();
  if (inProgress) win.label = `${win.mon3.toUpperCase()} 1-${today}, ${win.y}`;

  const orgId = client.organizationId || (await primaryOrgId());
  const c = await loadOneCompany(win, client, orgId, inProgress ? today : undefined);
  const extras = await loadCompanyExtras(win, orgId, c).catch(() => ({ competitors: [], gaps: [], recipientName: null, recipients: [] }));
  // The person's name is only right on a client's own report; everyone else gets the internal label.
  if (client.clientType !== "CAMPAIGN") extras.recipientName = "Gershon Consulting";

  let model: CompanyModel | null = companyModel(win, c, extras);
  if (model && inProgress) {
    model.head = model.head.replace(` in ${win.name}.`, ` so far in ${win.name}.`);
    model.ideas = model.ideas.filter((i) => !/^Reach /.test(i[0])); // month not over — no catch-up advice yet
  }
  if (!model) model = emptyModel(win, client.id, client.name, extras.recipientName, inProgress);

  if (inProgress) win.nextName = `the rest of ${win.name}`; // "Ideas for the rest of October"
  const pdf = companyPdf(win, model, buildLabel());
  const filename = `social-${slug(client.name) || "company"}-${key}${inProgress ? "-to-date" : ""}-v${APP_VERSION}.pdf`;
  return { pdf, filename };
}

export function emptyModel(win: MonthWindow, id: string, name: string, toName: string | null, inProgress: boolean): CompanyModel {
  const when = inProgress ? `so far in ${win.name}` : `in ${win.name} ${win.y}`;
  return {
    kind: "company", id, name, toName,
    head: `No posts collected for ${name} ${when}.`,
    lead: "Nothing was published on the LinkedIn or X pages we follow for this company during this period.",
    tiles: [
      { label: "POSTS PUBLISHED", value: "0", sub: "LinkedIn + X", color: "ink" },
      { label: "PER POST", value: "—", sub: "engagements per post", color: "ink" },
      { label: "ENGAGEMENT", value: "0", sub: "likes, comments and shares", color: "ink" },
      { label: "POSTING DAYS", value: "0", sub: "days with a post", color: "ink" },
    ],
    perDay: Array(win.dim).fill(0),
    themes: [], top: [],
    momentum: [[`Ready for ${inProgress ? "the rest of " + win.name : win.nextName}`, "Collection runs daily — posts appear here as soon as they are published."]],
    ideas: [], pct: null,
  };
}
