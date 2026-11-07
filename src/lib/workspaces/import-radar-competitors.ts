/**
 * One-shot (v4.69.0): import every client's competitors from Radar.
 *
 * Olivier, 2026-11-03: "We have the competitor from radar.gershoncrm.com/app,
 * can we collect these competitors and add to social.gershon.ai for all our
 * clients?"
 *
 * Source: Radar's Supabase (project pkzeeqehwmtnqxdpdesl), snapshot taken
 * 2026-11-03 — per client account, the sources with category "competitor"
 * (switched ON) plus the "Competitor sources" of the Gershon pre-analysis
 * (config key preanalysis_suggestions, still OFF in Radar). Entries without a
 * LinkedIn company page are skipped: Social collects through LinkedIn.
 *
 * Where they go (same model as link-altavia-competitors.ts, 2026-11-02):
 *   - Gershon (primary) workspace: each competitor is a COMPETITION company
 *     (ACTIVE, LinkedIn connection) so the Chrome extension collects it, and
 *     is linked to its client in OrgSetting `competitors:<clientId>` — the
 *     store Competitor Watch and the Competitive / Intelligence reports read.
 *   - VALOS: its competitors live in VALOS's own workspace (Dmitri's), never
 *     in Gershon's (purge-valos-from-gershon.ts, Olivier 2026-10-07). New ones
 *     are added there and linked to VALOS's own company.
 *
 * Matching: LinkedIn vanity first, then a normalised name, inside ONE
 * workspace — re-runs and companies that already exist are re-used, never
 * duplicated. Additive only (nothing deleted). Marker-guarded; never throws.
 * On the first complete run a summary email goes to report@.
 */
import prisma from "@/lib/db-raw";
import { ClientStatus, ClientType, ConnectionStatus, Platform } from "@prisma/client";
import { getCompetitorIds, setCompetitorIds } from "@/lib/competitors/store";
import { resolveFrom } from "@/lib/email/sender";
import { withAuditBcc } from "@/lib/mail-bcc";

const MARKER = "radar_competitors_import";
const MARKER_VERSION = "1";
const DMITRI_EMAIL = "dmitri.petratchenko@valos.it";
const REPORT_TO = ["report@gershonconsulting.com"];
const MAX_LINKS = 25;

type Comp = { name: string; linkedin: string; website?: string };
type Target = { client: string; match: RegExp; radarAccount: string; workspace: "gershon" | "valos"; competitors: Comp[] };

/** Radar snapshot, 2026-11-03. */
export const RADAR_COMPETITORS: Target[] = [
  {
    client: "Altavia North America",
    match: /altavia/i,
    radarAccount: "HhrpkVfuao",
    workspace: "gershon",
    competitors: [
      { name: "Acosta Group", linkedin: "https://www.linkedin.com/company/acosta/", website: "https://www.acosta.com/" },
      { name: "Array Marketing", linkedin: "https://www.linkedin.com/company/array-marketing/", website: "https://www.arraymarketing.com/" },
      { name: "HH Global", linkedin: "https://www.linkedin.com/company/hh-global/", website: "https://www.hhglobal.com/" },
      { name: "Mars United Commerce", linkedin: "https://www.linkedin.com/company/marsunitedcommerce/", website: "https://www.marsunited.com/" },
      { name: "Quad Agency Solutions", linkedin: "https://www.linkedin.com/company/quadgraphics/", website: "https://www.quad.com/" },
      { name: "RRD Marketing Solutions", linkedin: "https://www.linkedin.com/company/rr-donnelley/", website: "https://www.rrd.com/" },
      { name: "Tag", linkedin: "https://www.linkedin.com/company/tag/", website: "https://www.tagworldwide.com/" },
      { name: "Advantage Solutions", linkedin: "https://www.linkedin.com/company/advantagesolutionsinc/", website: "https://youradv.com/" },
      { name: "Geometry (WPP)", linkedin: "https://www.linkedin.com/company/geometry-global/", website: "https://www.geometry.com/" },
      { name: "Saatchi & Saatchi X", linkedin: "https://www.linkedin.com/company/saatchi-&-saatchi-x/", website: "https://www.saatchix.com/" },
      { name: "Smollan", linkedin: "https://www.linkedin.com/company/smollan-group/", website: "https://www.smollan.com/" },
      { name: "The Integer Group", linkedin: "https://www.linkedin.com/company/the-integer-group/", website: "https://www.integer.com/" },
    ],
  },
  {
    client: "Amphasys",
    match: /amphasys/i,
    radarAccount: "mrb4bdd3pi",
    workspace: "gershon",
    competitors: [
      { name: "Aber Instruments", linkedin: "https://www.linkedin.com/company/aber-instruments-ltd/" },
      { name: "Beckman Coulter Life Sciences", linkedin: "https://www.linkedin.com/company/beckman-coulter-ls/", website: "https://www.beckman.com/" },
      { name: "CDR BeerLab", linkedin: "https://www.linkedin.com/company/cdrbeerlab/" },
      { name: "Ceidos", linkedin: "https://www.linkedin.com/company/ceidos/" },
      { name: "ChemoMetec", linkedin: "https://www.linkedin.com/company/chemometec/", website: "https://chemometec.com/" },
      { name: "Hamilton Company", linkedin: "https://www.linkedin.com/company/hamilton-company/", website: "https://www.hamiltoncompany.com/" },
      { name: "Innofluidics", linkedin: "https://www.linkedin.com/company/innofluidics/" },
      { name: "Inspek Solutions", linkedin: "https://www.linkedin.com/company/inspek-solutions/" },
      { name: "Nova Biomedical", linkedin: "https://www.linkedin.com/company/nova-biomedical-corp/" },
      { name: "Sartorius", linkedin: "https://www.linkedin.com/company/sartorius/", website: "https://www.sartorius.com/" },
      { name: "SBT Instruments", linkedin: "https://www.linkedin.com/company/sbtinstruments/" },
      { name: "Revvity", linkedin: "https://www.linkedin.com/company/revvity/", website: "https://www.revvity.com/" },
      { name: "Logos Biosystems", linkedin: "https://www.linkedin.com/company/logosbio/", website: "https://www.logosbio.com/" },
      { name: "DeNovix", linkedin: "https://www.linkedin.com/company/denovix-inc-/", website: "https://www.denovix.com/" },
      { name: "Anton Paar USA", linkedin: "https://www.linkedin.com/company/anton-paar-usa/", website: "https://www.anton-paar.com/us-en/" },
      { name: "Oculyze", linkedin: "https://www.linkedin.com/company/oculyze/" },
    ],
  },
  {
    client: "Urban Factory",
    match: /urban ?factory/i,
    radarAccount: "bz3NkpOfOa",
    workspace: "gershon",
    competitors: [
      { name: "Targus", linkedin: "https://www.linkedin.com/company/targus/", website: "https://us.targus.com/" },
      { name: "Kensington", linkedin: "https://www.linkedin.com/company/kensington/", website: "https://www.kensington.com/" },
      { name: "StarTech.com", linkedin: "https://www.linkedin.com/company/startech-com/", website: "https://www.startech.com/" },
      { name: "Plugable", linkedin: "https://www.linkedin.com/company/plugable-technologies/", website: "https://plugable.com/" },
      { name: "Belkin", linkedin: "https://www.linkedin.com/company/belkin/", website: "https://www.belkin.com/" },
      { name: "Logitech for Business", linkedin: "https://www.linkedin.com/showcase/logitech-business/", website: "https://www.logitech.com/en-us/business.html" },
      { name: "Cyber Acoustics", linkedin: "https://www.linkedin.com/company/cyber-acoustics/", website: "https://www.cyberacoustics.com/" },
      { name: "CalDigit", linkedin: "https://www.linkedin.com/company/caldigit-inc/", website: "https://www.caldigit.com/" },
    ],
  },
  {
    client: "MAbSilico",
    match: /mab ?silico/i,
    radarAccount: "cjzJZHqxQy",
    workspace: "gershon",
    competitors: [
      { name: "BigHat Biosciences", linkedin: "https://www.linkedin.com/company/bighat-biosciences/", website: "https://www.bighatbio.com/" },
      { name: "Absci", linkedin: "https://www.linkedin.com/company/absci/", website: "https://www.absci.com/" },
      { name: "Generate:Biomedicines", linkedin: "https://www.linkedin.com/company/generate-biomedicines/", website: "https://generatebiomedicines.com/" },
      { name: "A-Alpha Bio", linkedin: "https://www.linkedin.com/company/aalphabio/", website: "https://www.aalphabio.com/" },
      { name: "Biolojic Design", linkedin: "https://www.linkedin.com/company/biolojic-design-ltd/", website: "https://www.biolojic.com/" },
      { name: "LabGenius Therapeutics", linkedin: "https://www.linkedin.com/company/labgeniustx/", website: "https://labgeniustx.com/" },
      { name: "Cradle", linkedin: "https://www.linkedin.com/company/cradlebio/", website: "https://www.cradle.bio/" },
      { name: "Nabla Bio", linkedin: "https://www.linkedin.com/company/nabla-bio/", website: "https://www.nabla.bio/" },
      { name: "EVQLV (Abtique)", linkedin: "https://www.linkedin.com/company/evqlv/", website: "https://www.abtique.com/" },
    ],
  },
  {
    client: "Flying Secoya",
    match: /flying ?secoya|secoya/i,
    radarAccount: "EWbwACtRbE",
    workspace: "gershon",
    competitors: [
      { name: "Entertainment Partners", linkedin: "https://www.linkedin.com/company/entertainment-partners/", website: "https://www.ep.com/" },
      { name: "BAFTA albert", linkedin: "https://www.linkedin.com/company/12976256/", website: "https://baftaalbert.org/" },
      { name: "Green The Bid", linkedin: "https://www.linkedin.com/showcase/greenthebid/", website: "https://www.greenthebid.earth/" },
      { name: "Green Eyes Production", linkedin: "https://www.linkedin.com/company/greeneyesfilmprod/", website: "https://greeneyesproduction.com/" },
      { name: "Sustainable Film", linkedin: "https://www.linkedin.com/company/sustainable-film/", website: "https://sustainablefilm.green/" },
      { name: "Leverage Point Entertainment", linkedin: "https://www.linkedin.com/company/leverage-point-entertainment/", website: "https://www.leveragepointent.com/" },
    ],
  },
  {
    client: "Phi-Tech",
    match: /phi-? ?tech/i,
    radarAccount: "UcDdaOGx4b",
    workspace: "gershon",
    competitors: [
      { name: "Fabric Genomics", linkedin: "https://www.linkedin.com/company/fabric-genomics/", website: "https://fabricgenomics.com/" },
      { name: "Emedgene (Illumina)", linkedin: "https://www.linkedin.com/company/emedgene/" },
      { name: "QIAGEN Digital Insights", linkedin: "https://www.linkedin.com/showcase/qiagen-bioinformatics/", website: "https://digitalinsights.qiagen.com/" },
      { name: "Velsera", linkedin: "https://www.linkedin.com/company/velseraofficial/", website: "https://velsera.com/" },
      { name: "Golden Helix", linkedin: "https://www.linkedin.com/company/golden-helix-inc/", website: "https://goldenhelix.com/" },
      { name: "SOPHiA GENETICS", linkedin: "https://www.linkedin.com/company/sophiagenetics/", website: "https://www.sophiagenetics.com/" },
      { name: "Genomenon", linkedin: "https://www.linkedin.com/company/genomenon/", website: "https://www.genomenon.com/" },
      { name: "Geneyx", linkedin: "https://www.linkedin.com/company/geneyxgenomex/", website: "https://geneyx.com/" },
      { name: "SeqOne", linkedin: "https://www.linkedin.com/company/seqone/", website: "https://www.seqone.com/" },
      { name: "Nostos Genomics", linkedin: "https://www.linkedin.com/company/nostosgenomics/", website: "https://nostos-genomics.com/" },
    ],
  },
  {
    client: "VALOS",
    match: /\bvalos\b/i,
    radarAccount: "oGSazFvHRu",
    workspace: "valos",
    competitors: [
      { name: "Veramed", linkedin: "https://www.linkedin.com/company/veramed/" },
      { name: "Quanticate", linkedin: "https://www.linkedin.com/company/quanticate/", website: "https://www.quanticate.com/" },
      { name: "Phastar", linkedin: "https://www.linkedin.com/company/phastar/", website: "https://phastar.com/" },
      { name: "Statistics & Data Corporation", linkedin: "https://www.linkedin.com/company/statistics-%26-data-corporation/", website: "https://www.sdcclinical.com/" },
      { name: "Everest Clinical Research", linkedin: "https://www.linkedin.com/company/337453/", website: "https://www.everestclinical.com/" },
      { name: "Cytel", linkedin: "https://www.linkedin.com/company/cytel/", website: "https://cytel.com/" },
      { name: "Rho", linkedin: "https://www.linkedin.com/company/rhoworld/", website: "https://www.rhoworld.com/" },
      { name: "IDDI", linkedin: "https://www.linkedin.com/company/iddi/", website: "https://www.iddi.com/" },
      { name: "Ephicacy Lifescience Analytics", linkedin: "https://www.linkedin.com/company/ephicacy-lifescience-analytics/", website: "https://www.ephicacy.com/" },
      { name: "Emmes", linkedin: "https://www.linkedin.com/company/the-emmes-group/", website: "https://theemmesgroup.com/" },
    ],
  },
];

/** LinkedIn page key: "company/acosta", "showcase/logitech-business". */
export function linkedinKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = String(url).toLowerCase().match(/linkedin\.com\/(company|showcase|school)\/([^/?#]+)/);
  if (!m) return null;
  let v = m[2];
  try {
    v = decodeURIComponent(v);
  } catch {
    /* keep raw */
  }
  return `${m[1]}/${v.replace(/\/+$/, "")}`;
}

const STOP = new Set(["inc", "ltd", "llc", "corp", "corporation", "co", "company", "group", "the", "sa", "ag", "gmbh"]);
/** "Rho Inc." → "rho", "Statistics & Data Corporation (SDC)" → "statistics data". */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ");
}

/** Same company? Exact normalised name, or one name extends the other ("Ephicacy" / "Ephicacy Lifescience Analytics"). */
export function sameName(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 5 && l.startsWith(s + " ");
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "competitor"
  );
}

async function freeSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const taken = await prisma.client.findFirst({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

type Existing = { id: string; name: string; keys: Set<string> };

async function loadWorkspace(orgId: string): Promise<Existing[]> {
  const rows = await prisma.client.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, platformConnections: { select: { externalAccountUrl: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    keys: new Set(r.platformConnections.map((p) => linkedinKey(p.externalAccountUrl)).filter((k): k is string => !!k)),
  }));
}

type Line = { client: string; status: string; linked: string[]; created: string[]; reused: string[] };

async function importOne(orgId: string, target: Target, owner: { id: string; name: string }, existing: Existing[]): Promise<Line> {
  const line: Line = { client: owner.name, status: "ok", linked: [], created: [], reused: [] };
  const ids: string[] = [];
  for (const c of target.competitors) {
    const key = linkedinKey(c.linkedin);
    let hit = existing.find((e) => e.id !== owner.id && key && e.keys.has(key)) || existing.find((e) => e.id !== owner.id && sameName(e.name, c.name));
    if (hit) {
      line.reused.push(hit.name);
      // A re-used company without a LinkedIn connection gets the Radar one.
      if (key && !hit.keys.has(key)) {
        const has = await prisma.platformConnection.findFirst({ where: { clientId: hit.id, platform: Platform.LINKEDIN }, select: { id: true } });
        if (!has) {
          await prisma.platformConnection.create({
            data: { clientId: hit.id, organizationId: orgId, platform: Platform.LINKEDIN, externalAccountUrl: c.linkedin, connectionStatus: ConnectionStatus.PENDING, isMandatory: false, isEnabled: true },
          });
          hit.keys.add(key);
        }
      }
    } else {
      const created = await prisma.client.create({
        data: {
          organizationId: orgId,
          name: c.name,
          slug: await freeSlug(c.name),
          status: ClientStatus.ACTIVE,
          clientType: ClientType.COMPETITION,
          website: c.website ?? null,
          notes: `Competitor of ${owner.name} — imported from Radar (radar.gershoncrm.com) on 2026-11-03.`,
        },
        select: { id: true, name: true },
      });
      await prisma.platformConnection.create({
        data: { clientId: created.id, organizationId: orgId, platform: Platform.LINKEDIN, externalAccountUrl: c.linkedin, connectionStatus: ConnectionStatus.PENDING, isMandatory: false, isEnabled: true },
      });
      hit = { id: created.id, name: created.name, keys: new Set(key ? [key] : []) };
      existing.push(hit);
      line.created.push(created.name);
    }
    ids.push(hit.id);
  }
  const current = await getCompetitorIds(orgId, owner.id);
  const merged = Array.from(new Set([...current, ...ids]));
  if (merged.length > MAX_LINKS) line.status = `linked first ${MAX_LINKS} (limit)`;
  await setCompetitorIds(orgId, owner.id, merged);
  const after = new Set(merged.slice(0, MAX_LINKS));
  line.linked = target.competitors.filter((_, i) => after.has(ids[i])).map((c) => c.name);
  return line;
}

async function findOwner(orgId: string, target: Target) {
  const rows = await prisma.client.findMany({
    where: {
      organizationId: orgId,
      archivedAt: null,
      clientType: { notIn: [ClientType.COMPETITION, ClientType.PARTNER] },
    },
    select: { id: true, name: true, clientType: true },
  });
  const hits = rows.filter((r) => target.match.test(r.name));
  const rank = (t: ClientType) => (t === ClientType.CAMPAIGN ? 0 : t === ClientType.INTERNAL ? 1 : 2);
  hits.sort((a, b) => rank(a.clientType) - rank(b.clientType));
  return hits[0] ?? null;
}

export type RadarImportSummary = { at: string; lines: Line[] };

export async function runRadarCompetitorImport(): Promise<RadarImportSummary> {
  const lines: Line[] = [];
  const primary = await prisma.organization.findFirst({ where: { isPrimary: true }, select: { id: true } });
  let valosOrgId: string | null = null;
  const dmitri = await prisma.user.findFirst({ where: { email: { equals: DMITRI_EMAIL, mode: "insensitive" } }, select: { organizationId: true } });
  if (dmitri?.organizationId && dmitri.organizationId !== primary?.id) valosOrgId = dmitri.organizationId;

  const cache = new Map<string, Existing[]>();
  for (const target of RADAR_COMPETITORS) {
    const orgId = target.workspace === "valos" ? valosOrgId : primary?.id ?? null;
    if (!orgId) {
      lines.push({ client: target.client, status: "workspace not found", linked: [], created: [], reused: [] });
      continue;
    }
    try {
      const owner = await findOwner(orgId, target);
      if (!owner) {
        lines.push({ client: target.client, status: "company not found in Social", linked: [], created: [], reused: [] });
        continue;
      }
      if (!cache.has(orgId)) cache.set(orgId, await loadWorkspace(orgId));
      lines.push(await importOne(orgId, target, owner, cache.get(orgId)!));
    } catch (e) {
      lines.push({ client: target.client, status: `error: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`, linked: [], created: [], reused: [] });
    }
  }
  return { at: new Date().toISOString(), lines };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

async function emailSummary(sum: RadarImportSummary): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const total = sum.lines.reduce((n, l) => n + l.linked.length, 0);
  const created = sum.lines.reduce((n, l) => n + l.created.length, 0);
  const rows = sum.lines
    .map(
      (l) => `<tr>
        <td style="padding:6px 10px;border-top:1px solid #eee;vertical-align:top"><b>${esc(l.client)}</b><br><span style="color:#888;font-size:12px">${esc(l.status)}</span></td>
        <td style="padding:6px 10px;border-top:1px solid #eee;vertical-align:top;text-align:right">${l.linked.length}</td>
        <td style="padding:6px 10px;border-top:1px solid #eee;vertical-align:top;font-size:13px">${esc(l.linked.join(", ") || "—")}${l.created.length ? `<br><span style="color:#888">new in Social: ${l.created.length}</span>` : ""}</td>
      </tr>`,
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#111;max-width:760px">
    <h2 style="margin:0 0 6px">[SOC-RADAR] Radar competitors added to Social</h2>
    <p style="margin:0 0 14px;color:#555">${total} competitor links across ${sum.lines.filter((l) => l.linked.length).length} clients; ${created} new Competition companies created with their LinkedIn page. The Social Chrome extension starts collecting them on its next run.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <tr style="background:#f6f6f6"><th style="padding:6px 10px;text-align:left">Client</th><th style="padding:6px 10px;text-align:right">Competitors</th><th style="padding:6px 10px;text-align:left">Linked from Radar</th></tr>
      ${rows}
    </table>
    <p style="color:#888;font-size:12px;margin-top:14px">Source: radar.gershoncrm.com — competitor sources + Gershon pre-analysis, snapshot 2026-11-03. VALOS's list goes to the VALOS workspace only. social.gershon.ai</p>
  </div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withAuditBcc({ from: resolveFrom(), to: REPORT_TO, subject: `[SOC-RADAR] ${total} Radar competitors added to Social`, html })),
    });
    return r.ok;
  } catch {
    return false;
  }
}

let done = false;

/** Called from the daily cron. Runs once (marker), retried on the next run if it failed. */
export async function importRadarCompetitorsOnce(): Promise<RadarImportSummary | null> {
  if (done) return null;
  try {
    const org = await prisma.organization.findFirst({ where: { isPrimary: true }, select: { id: true } });
    if (!org) return null;
    const marker = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: org.id, key: MARKER } } });
    if (marker) {
      try {
        if (JSON.parse(marker.value)?.v === MARKER_VERSION) {
          done = true;
          return null;
        }
      } catch {
        /* rerun */
      }
    }
    const sum = await runRadarCompetitorImport();
    const failed = sum.lines.some((l) => l.status.startsWith("error") || l.status === "workspace not found");
    const emailed = await emailSummary(sum);
    if (!failed) {
      const value = JSON.stringify({ v: MARKER_VERSION, emailed, ...sum });
      await prisma.orgSetting.upsert({
        where: { organizationId_key: { organizationId: org.id, key: MARKER } },
        update: { value },
        create: { organizationId: org.id, key: MARKER, value },
      });
      done = true;
    }
    return sum;
  } catch {
    return null; // best effort — retried on the next run
  }
}
