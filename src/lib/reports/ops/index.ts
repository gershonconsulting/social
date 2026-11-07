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
import { deliver, type DeliveryResult, type OpsKind } from "./shell";
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

export async function buildOps(kind: OpsKind, orgId?: string, opts: { refresh?: boolean } = {}): Promise<Built> {
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
    return { kind, dayKey: r.dayKey, subject: intelligenceSubject(r, ws), html: renderIntelligence(r), data: r };
  }
  // Competitive carries the week's suggested actions (same daily-cached Intelligence run).
  const intel = await buildIntelligenceReport(org, opts).catch(() => null);
  const r = intel?.competitive || (await buildCompetitiveReport(org));
  return { kind, dayKey: r.dayKey, subject: competitiveSubject(r, ws), html: renderCompetitive(r, { actions: intel?.intel.actions }), data: r };
}

/** Build and send the given reports (all three by default). One failure never stops the others. */
export async function sendOps(opts: { kinds?: OpsKind[]; force?: boolean; to?: string } = {}): Promise<Array<DeliveryResult | { kind: OpsKind; sent: false; error: string }>> {
  const org = await primaryOrgId();
  const out: Array<DeliveryResult | { kind: OpsKind; sent: false; error: string }> = [];
  for (const kind of opts.kinds || OPS_KINDS) {
    try {
      const b = await buildOps(kind, org);
      out.push(await deliver(kind, b.dayKey, b.subject, b.html, { force: opts.force, to: opts.to, defaultTo: defaultTo(kind) }));
    } catch (e) {
      out.push({ kind, sent: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export function isOpsKind(v: string | null): v is OpsKind {
  return !!v && (OPS_KINDS as string[]).includes(v);
}
