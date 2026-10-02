/**
 * One-shot: widen VALOS's collection coverage for the community analysis.
 *
 * Olivier, 2026-10-02: "collect as much posts from them, their competitors and
 * any partners we can find to create a comprehensive report."
 *
 * Two workspaces, two jobs — both additive, nothing deleted:
 *
 * 1. GERSHON (primary) workspace — this is where collection actually runs
 *    every day (Olivier's Chrome extension). VALOS is already tracked there
 *    with 8 competitors (Competitor Watch, v4.11.0). Add the three on the new
 *    list it lacks (Ephicacy, PROMETRIKA, Rho) and the partner Bio4Dreams, and
 *    link the new competitors to VALOS. Gershon's VALOS is found by its
 *    LinkedIn link, never by name.
 *
 * 2. VALOS workspace (Dmitri's) — add X accounts for the competitors that
 *    have one, and Bio4Dreams as PARTNER. Waits for seedValosWorkspace().
 *
 * Bio4Dreams: Milan life-sciences incubator; strategic partnership with VALOS
 * announced 8 May 2025 (bio4dreams.com/en/partnership-valos-...).
 *
 * Matching is by LinkedIn vanity within ONE workspace, so re-runs and
 * companies that already exist are re-used, not duplicated. Marker-guarded,
 * silent on failure.
 */
import prisma from "@/lib/db-raw";
import { ClientStatus, ClientType, ConnectionStatus, Platform } from "@prisma/client";

const DMITRI_EMAIL = "dmitri.petratchenko@valos.it";
const SEEDED_MARKER = "valos_workspace_seeded";
const MARKER_KEY = "valos_coverage_v2";
const MARKER_VERSION = "1";

type Co = { name: string; clientType: ClientType; linkedin: string; x?: string; notes?: string };

const BIO4DREAMS: Co = {
  name: "Bio4Dreams",
  clientType: ClientType.PARTNER,
  linkedin: "https://www.linkedin.com/company/bio4dreams/",
  notes: "Milan life-sciences incubator. Strategic partnership with VALOS announced May 2025.",
};

const NEW_IN_GERSHON: Co[] = [
  { name: "Ephicacy", clientType: ClientType.COMPETITION, linkedin: "https://www.linkedin.com/company/ephicacy-lifescience-analytics/", notes: "US and India. Clinical and RWE biometrics." },
  { name: "PROMETRIKA", clientType: ClientType.COMPETITION, linkedin: "https://www.linkedin.com/company/prometrika-llc/", notes: "Massachusetts. Direct local rival to VALOS's Boston office." },
  { name: "Rho Inc.", clientType: ClientType.COMPETITION, linkedin: "https://www.linkedin.com/company/rho-inc-/", notes: "North Carolina. Full-service CRO known for its biostatistics." },
];

/** X accounts already verified on the Gershon side (Competitor Watch, 2026-09-25). */
const X_BY_LINKEDIN: Record<string, string> = {
  "quanticate": "https://x.com/Quanticate",
  "phastar": "https://x.com/TeamPhastar",
  "veramed": "https://x.com/WeAreVeramed",
  "cytel": "https://x.com/cytel",
  "statistics-%26-data-corporation": "https://x.com/SDCclinical",
};

let doneInThisIsolate = false;

function vanity(url: string | null | undefined): string | null {
  const m = (url || "").match(/linkedin\.com\/(?:company|in|school)\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "company";
}

/** The workspace's company whose LinkedIn link has this vanity, if any. */
async function findByLinkedIn(orgId: string, v: string): Promise<string | null> {
  const conns = await prisma.platformConnection.findMany({
    where: { organizationId: orgId, platform: Platform.LINKEDIN, externalAccountUrl: { contains: v, mode: "insensitive" } },
    select: { clientId: true, externalAccountUrl: true },
  });
  const hit = conns.find((c) => vanity(c.externalAccountUrl) === v);
  return hit?.clientId ?? null;
}

async function ensureLink(orgId: string, clientId: string, platform: Platform, url: string) {
  const existing = await prisma.platformConnection.findUnique({
    where: { clientId_platform: { clientId, platform } },
  });
  if (existing) {
    if (!existing.externalAccountUrl) {
      await prisma.platformConnection.update({ where: { id: existing.id }, data: { externalAccountUrl: url, isEnabled: true } });
    }
    return;
  }
  await prisma.platformConnection.create({
    data: {
      organizationId: orgId,
      clientId,
      platform,
      externalAccountUrl: url,
      connectionStatus: ConnectionStatus.PENDING,
      isMandatory: true,
      isEnabled: true,
    },
  });
}

async function ensureCompany(org: { id: string; slug: string }, c: Co): Promise<string> {
  const v = vanity(c.linkedin)!;
  let id = await findByLinkedIn(org.id, v);
  if (!id) {
    const base = `${slugify(c.name)}-${org.slug}`.slice(0, 100);
    let slug = base;
    for (let i = 2; await prisma.client.findUnique({ where: { slug }, select: { id: true } }); i++) {
      slug = `${base}-${i}`.slice(0, 100);
      if (i > 30) throw new Error("Could not find a free slug");
    }
    const created = await prisma.client.create({
      data: { organizationId: org.id, name: c.name, slug, status: ClientStatus.ACTIVE, clientType: c.clientType, notes: c.notes ?? null },
    });
    id = created.id;
  }
  await ensureLink(org.id, id, Platform.LINKEDIN, c.linkedin);
  if (c.x) await ensureLink(org.id, id, Platform.TWITTER, c.x);
  return id;
}

async function addCompetitors(orgId: string, companyId: string, ids: string[]) {
  const key = `competitors:${companyId}`;
  const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } });
  let current: string[] = [];
  try { current = row ? (JSON.parse(row.value) as string[]) : []; } catch { current = []; }
  const value = JSON.stringify(Array.from(new Set([...current, ...ids])).slice(0, 25));
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value },
    update: { value },
  });
}

async function gershonSide(): Promise<{ added: number } | null> {
  const primary = await prisma.organization.findFirst({ where: { isPrimary: true } });
  if (!primary) return null;
  const valosId = (await findByLinkedIn(primary.id, "valos-srl")) ?? (await findByLinkedIn(primary.id, "76359943"));
  if (!valosId) return null;
  const ids: string[] = [];
  for (const c of NEW_IN_GERSHON) ids.push(await ensureCompany(primary, c));
  await addCompetitors(primary.id, valosId, ids);
  await ensureCompany(primary, BIO4DREAMS);
  return { added: ids.length + 1 };
}

async function valosSide(): Promise<{ xLinks: number } | null> {
  if (!(await prisma.setting.findUnique({ where: { key: SEEDED_MARKER } }))) return null;
  const user = await prisma.user.findFirst({
    where: { email: { equals: DMITRI_EMAIL, mode: "insensitive" } },
    select: { organizationId: true },
  });
  if (!user?.organizationId) return null;
  const org = await prisma.organization.findUnique({ where: { id: user.organizationId } });
  if (!org || org.isPrimary) return null;

  let xLinks = 0;
  for (const [v, x] of Object.entries(X_BY_LINKEDIN)) {
    const id = await findByLinkedIn(org.id, v);
    if (id) { await ensureLink(org.id, id, Platform.TWITTER, x); xLinks++; }
  }
  await ensureCompany(org, BIO4DREAMS);
  return { xLinks };
}

export async function extendValosCoverage(): Promise<void> {
  if (doneInThisIsolate) return;
  try {
    const marker = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
    if (marker && (JSON.parse(marker.value) as { version?: string }).version === MARKER_VERSION) {
      doneInThisIsolate = true;
      return;
    }
    const g = await gershonSide();
    const v = await valosSide();
    if (!g || !v) return; // a side isn't ready yet — retry on a later request
    const value = JSON.stringify({ version: MARKER_VERSION, gershon: g, valos: v, at: new Date().toISOString() });
    await prisma.setting.upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value }, update: { value } });
    doneInThisIsolate = true;
  } catch {
    // Retried on the next request.
  }
}
