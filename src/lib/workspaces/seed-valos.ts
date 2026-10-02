/**
 * One-shot: VALOS's own companies, entered fresh in Dmitri's workspace.
 *
 * Olivier, 2026-10-02 — after emptying the workspace of Gershon's mirrored
 * copies: "Now let's add Valos for Internal collection" plus nine named
 * competitors. These are NEW rows owned by the VALOS workspace, not mirrors:
 * no mirror links, nothing copied from Gershon. Dmitri's own extension
 * (workspace token) collects them.
 *
 * Ordering: it waits for isolateDmitri()'s marker, so the emptying can never
 * run after it and delete what it created. Idempotent (re-uses a company of
 * the same name in the workspace, upserts its links), marker-guarded, silent
 * on failure.
 */
import prisma from "@/lib/db-raw";
import { ClientStatus, ClientType, ConnectionStatus, Platform } from "@prisma/client";

const DMITRI_EMAIL = "dmitri.petratchenko@valos.it";
const EMPTIED_MARKER = "dmitri_workspace_emptied";
const MARKER_KEY = "valos_workspace_seeded";
const MARKER_VERSION = "1";

type Seed = {
  name: string;
  clientType: ClientType;
  linkedin: string;
  x?: string;
  notes?: string;
};

const VALOS: Seed = {
  name: "VALOS",
  clientType: ClientType.INTERNAL,
  linkedin: "https://www.linkedin.com/company/76359943/",
  x: "https://x.com/valossrl",
};

const COMPETITORS: Seed[] = [
  { name: "Quanticate", linkedin: "https://www.linkedin.com/company/quanticate/", notes: "UK, with US offices. Biometrics and FSP specialist, the closest match." },
  { name: "Phastar", linkedin: "https://www.linkedin.com/company/phastar/", notes: "UK, with US offices. Specialist biometrics CRO with a strong focus on biotech." },
  { name: "Veramed", linkedin: "https://www.linkedin.com/company/veramed/", notes: "UK, with US offices. Biostatistics and programming only." },
  { name: "Cytel", linkedin: "https://www.linkedin.com/company/cytel/", notes: "Boston. Biostatistics, plus its own software and RWE work." },
  { name: "Statistics & Data Corporation (SDC)", linkedin: "https://www.linkedin.com/company/statistics-%26-data-corporation/", notes: "Arizona. Biostatistics, data management and programming." },
  { name: "Everest Clinical Research", linkedin: "https://www.linkedin.com/company/everest-clinical-research-services-inc-/", notes: "Canada and US. Biometrics-heavy CRO." },
  { name: "Ephicacy", linkedin: "https://www.linkedin.com/company/ephicacy-lifescience-analytics/", notes: "US and India. Clinical and RWE biometrics." },
  { name: "PROMETRIKA", linkedin: "https://www.linkedin.com/company/prometrika-llc/", notes: "Massachusetts. Mid-size CRO with its own biostatistics and programming team; direct local rival to VALOS's Boston office." },
  { name: "Rho Inc.", linkedin: "https://www.linkedin.com/company/rho-inc-/", notes: "North Carolina. Full-service CRO known for its biostatistics." },
].map((c) => ({ ...c, clientType: ClientType.COMPETITION }));

let doneInThisIsolate = false;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "company";
}

async function upsertCompany(org: { id: string; slug: string }, s: Seed): Promise<string> {
  let client = await prisma.client.findFirst({ where: { organizationId: org.id, name: s.name } });
  if (!client) {
    // Client.slug is unique across ALL workspaces.
    const base = `${slugify(s.name)}-${org.slug}`.slice(0, 100);
    let slug = base;
    for (let i = 2; await prisma.client.findUnique({ where: { slug }, select: { id: true } }); i++) {
      slug = `${base}-${i}`.slice(0, 100);
      if (i > 30) throw new Error("Could not find a free slug");
    }
    client = await prisma.client.create({
      data: {
        organizationId: org.id,
        name: s.name,
        slug,
        status: ClientStatus.ACTIVE,
        clientType: s.clientType,
        notes: s.notes ?? null,
      },
    });
  } else if (client.clientType !== s.clientType) {
    await prisma.client.update({ where: { id: client.id }, data: { clientType: s.clientType } });
  }

  const links: Array<[Platform, string]> = [[Platform.LINKEDIN, s.linkedin]];
  if (s.x) links.push([Platform.TWITTER, s.x]);
  for (const [platform, url] of links) {
    await prisma.platformConnection.upsert({
      where: { clientId_platform: { clientId: client.id, platform } },
      create: {
        organizationId: org.id,
        clientId: client.id,
        platform,
        externalAccountUrl: url,
        connectionStatus: ConnectionStatus.PENDING,
        isMandatory: true,
        isEnabled: true,
      },
      update: { externalAccountUrl: url, isEnabled: true },
    });
  }
  return client.id;
}

export async function seedValosWorkspace(): Promise<void> {
  if (doneInThisIsolate) return;
  try {
    const marker = await prisma.setting.findUnique({ where: { key: MARKER_KEY } });
    if (marker && (JSON.parse(marker.value) as { version?: string }).version === MARKER_VERSION) {
      doneInThisIsolate = true;
      return;
    }
    // Never before the emptying — it would delete these rows.
    const emptied = await prisma.setting.findUnique({ where: { key: EMPTIED_MARKER } });
    if (!emptied) return;

    const user = await prisma.user.findFirst({
      where: { email: { equals: DMITRI_EMAIL, mode: "insensitive" } },
      select: { organizationId: true },
    });
    if (!user?.organizationId) return;
    const org = await prisma.organization.findUnique({ where: { id: user.organizationId } });
    if (!org || org.isPrimary) return; // never seed into Gershon's workspace

    const valosId = await upsertCompany(org, VALOS);
    const competitorIds: string[] = [];
    for (const c of COMPETITORS) competitorIds.push(await upsertCompany(org, c));

    // Competitor Watch: VALOS vs these nine (same storage as competitors/store.ts).
    const key = `competitors:${valosId}`;
    const value = JSON.stringify(competitorIds);
    await prisma.orgSetting.upsert({
      where: { organizationId_key: { organizationId: org.id, key } },
      create: { organizationId: org.id, key, value },
      update: { value },
    });

    const m = JSON.stringify({ version: MARKER_VERSION, orgId: org.id, valosId, competitors: competitorIds.length, at: new Date().toISOString() });
    await prisma.setting.upsert({ where: { key: MARKER_KEY }, create: { key: MARKER_KEY, value: m }, update: { value: m } });
    doneInThisIsolate = true;
  } catch {
    // Retried on the next request.
  }
}
