/**
 * The three operations reports next to the daily Collection report.
 * One entry point to build, render and send each of them.
 */
import rawDb from "@/lib/db-raw";
import { primaryOrgId } from "../monthly/data";
import { linkAltaviaCompetitors } from "@/lib/workspaces/link-altavia-competitors";
import { buildPostingReport, renderPosting, postingSubject } from "./posting";
import { buildCompetitiveReport, renderCompetitive, competitiveSubject } from "./competitive";
import { buildIntelligenceReport, renderIntelligence, intelligenceSubject, INTEL_TO } from "./intelligence";
import { deliver, SITE, WORKSPACE_FROM, type DeliveryResult, type OpsKind } from "./shell";
import { cardButtonsHtml, cardsEmailHtml, resultsEmailHtml } from "@/lib/actions/render";
import { cardId, pillarOf } from "@/lib/actions/store";
import { buildResults } from "@/lib/actions/results";
import { workspaceLabel } from "../report-subject";

// v4.65.0: "content" (Content Ready — approved posts waiting to publish) left
// with publishing; Publish's own daily inventory email covers it.
export const OPS_KINDS: OpsKind[] = ["posting", "competitive", "intelligence"];

/** Who each report goes to by default: everything to report@, Intelligence to sales@. */
export function defaultTo(kind: OpsKind): string | undefined {
  return kind === "intelligence" ? process.env.INTEL_REPORT_TO || INTEL_TO : undefined;
}

export type Built = { kind: OpsKind; dayKey: string; subject: string; html: string; data: unknown };

/** The workspace's name for the subject line (v4.68.0 — social.gershon.ai now has several users). */
async function workspaceName(orgId: string): Promise<string | undefined> {
  try {
    const o = await rawDb.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    return o?.name?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function buildOps(kind: OpsKind, orgId?: string, opts: { refresh?: boolean; actionLinks?: boolean } = {}): Promise<Built> {
  // v4.70.0 review: the public (no-session) preview must never carry signed Done/Dismiss links.
  const withLinks = opts.actionLinks !== false;
  const org = orgId || (await primaryOrgId());
  await linkAltaviaCompetitors();
  // Never drop the workspace from the subject: a failed name lookup used to
  // send "Social Intelligence Report — <date>" without "Gershon Consulting".
  const ws = workspaceLabel(await workspaceName(org));
  if (kind === "posting") {
    const r = await buildPostingReport(org);
    return { kind, dayKey: r.dayKey, subject: postingSubject(r, ws), html: renderPosting(r), data: r };
  }
  if (kind === "intelligence") {
    const r = await buildIntelligenceReport(org, opts);
    // v4.70.0: Draft it / Done / Dismiss under every action.
    const buttons = await Promise.all(
      r.intel.actions.map(async (a) => {
        const c = r.cards.find((x) => x.id === cardId(r.dayKey, pillarOf(a.action), a.action));
        return c && withLinks ? cardButtonsHtml(org, c).catch(() => "") : "";
      }),
    );
    return { kind, dayKey: r.dayKey, subject: intelligenceSubject(r, ws), html: renderIntelligence(r, { buttons }), data: r };
  }
  // Competitive carries the week's suggested actions (same daily-cached Intelligence run),
  // as cards with one-click buttons (v4.70.0) and what happened with last week's.
  const intel = await buildIntelligenceReport(org, opts).catch(() => null);
  const r = intel?.competitive || (await buildCompetitiveReport(org));
  const cardsHtml = intel?.cards.length && withLinks ? await cardsEmailHtml(org, intel.cards).catch(() => "") : "";
  const resultsHtml = await buildResults(org).then(resultsEmailHtml).catch(() => "");
  const html = renderCompetitive(r, {
    actions: intel?.intel.actions,
    cardsHtml: cardsHtml || undefined,
    resultsHtml: resultsHtml || undefined,
    ownName: intel?.ownName,
    isPrimary: intel?.isPrimary,
  });
  return { kind, dayKey: r.dayKey, subject: competitiveSubject(r, ws), html, data: r };
}

/**
 * v4.70.0 — every other workspace on social.gershon.ai that watches at least
 * one competitor or partner gets its own Competitive report (with its own
 * actions), sent to that workspace's admins. Posting and Intelligence stay
 * Gershon-only (they are about Gershon's campaign work and go to sales@).
 */
export async function competitiveWorkspaces(primaryId: string): Promise<Array<{ id: string; name: string; to: string[] }>> {
  const orgs = await rawDb.organization.findMany({ where: { isPrimary: false }, select: { id: true, name: true } });
  const out: Array<{ id: string; name: string; to: string[] }> = [];
  for (const o of orgs) {
    if (o.id === primaryId) continue;
    const [watched, admins] = await Promise.all([
      rawDb.client.count({ where: { organizationId: o.id, archivedAt: null, status: { not: "ARCHIVED" }, clientType: { in: ["COMPETITION", "PARTNER"] } } }),
      rawDb.user.findMany({ where: { organizationId: o.id, isActive: true, pendingApproval: false, role: "ADMIN" }, select: { email: true } }),
    ]);
    const to = admins.map((a) => a.email).filter((e) => /@/.test(e));
    if (watched > 0 && to.length) out.push({ id: o.id, name: o.name, to });
  }
  return out;
}

type SendResult = (DeliveryResult & { workspace?: string }) | { kind: OpsKind; sent: false; error: string; workspace?: string };

/** Build and send the given reports (all three by default). One failure never stops the others. */
export async function sendOps(opts: { kinds?: OpsKind[]; force?: boolean; to?: string; workspaces?: boolean } = {}): Promise<SendResult[]> {
  const org = await primaryOrgId();
  const out: SendResult[] = [];
  for (const kind of opts.kinds || OPS_KINDS) {
    try {
      const b = await buildOps(kind, org);
      out.push(await deliver(kind, b.dayKey, b.subject, b.html, { force: opts.force, to: opts.to, defaultTo: defaultTo(kind) }));
    } catch (e) {
      out.push({ kind, sent: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (opts.workspaces !== false && (!opts.kinds || opts.kinds.includes("competitive"))) {
    let list: Array<{ id: string; name: string; to: string[] }> = [];
    try {
      list = await competitiveWorkspaces(org);
    } catch (e) {
      out.push({ kind: "competitive", sent: false, error: `workspace list: ${e instanceof Error ? e.message : String(e)}` });
    }
    // Each workspace is built in its OWN request (one call back to this route per
    // workspace), so the morning cron never runs out of Worker subrequests as
    // workspaces are added — every report needs a dozen database reads + one AI call.
    const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || "";
    for (const w of list) {
      try {
        const q = new URLSearchParams({ kind: "competitive", workspace: w.id });
        if (opts.force) q.set("force", "1");
        if (opts.to) q.set("to", opts.to);
        const r = await fetch(`${SITE}/api/report/ops?${q}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
        const j = (await r.json().catch(() => null)) as { data?: SendResult[] } | null;
        if (j?.data?.length) out.push(...j.data.map((x) => ({ ...x, workspace: w.name })));
        else out.push({ kind: "competitive", sent: false, error: `HTTP ${r.status}`, workspace: w.name });
      } catch (e) {
        out.push({ kind: "competitive", sent: false, error: e instanceof Error ? e.message : String(e), workspace: w.name });
      }
    }
  }
  return out;
}

export const CLIENT_REVIEW_TO = "report@gershonconsulting.com";
const CLIENT_HOLD_KEY = "client_reports_hold";

/** Client reports are held for review unless Setting client_reports_hold = "off". */
export async function clientReportsHeld(): Promise<boolean> {
  try {
    const row = await rawDb.setting.findUnique({ where: { key: CLIENT_HOLD_KEY } });
    return (row?.value || "").trim().toLowerCase() !== "off";
  } catch {
    return true; // fail safe: never mail a client when we cannot read the switch
  }
}

/** One workspace's own Competitive report (with its actions) → its admins. Called once per workspace by sendOps. */
export async function sendWorkspaceCompetitive(orgId: string, opts: { force?: boolean; to?: string } = {}): Promise<SendResult[]> {
  const primary = await primaryOrgId();
  const w = (await competitiveWorkspaces(primary)).find((x) => x.id === orgId);
  if (!w) return [{ kind: "competitive", sent: false, error: "workspace has no competitor/partner or no admin to send to" }];
  const b = await buildOps("competitive", w.id);
  // v4.77.0 — Olivier 2026-11-10: "Do not send the reports to clients yet, we need to
  // review them". While the hold is on (default), a client workspace's report goes to
  // report@ for review, never to the client's admins.
  if (!opts.to && (await clientReportsHeld())) {
    const subject = `[REVIEW — not sent to client] ${b.subject} (would go to ${w.to.join(", ")})`;
    return [await deliver("competitive", b.dayKey, subject, b.html, { force: opts.force, to: CLIENT_REVIEW_TO, sentKey: `competitive-review:${w.id}:${b.dayKey}`, from: WORKSPACE_FROM })];
  }
  return [await deliver("competitive", b.dayKey, b.subject, b.html, { force: opts.force, to: opts.to || w.to.join(","), sentKey: `competitive:${w.id}:${b.dayKey}`, from: WORKSPACE_FROM })];
}

export function isOpsKind(v: string | null): v is OpsKind {
  return !!v && (OPS_KINDS as string[]).includes(v);
}
