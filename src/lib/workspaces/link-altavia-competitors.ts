/**
 * One-shot (v4.68.0): link Altavia North America's competitors to Altavia.
 *
 * On 2026-10-21 eight COMPETITION companies were added to the Gershon
 * workspace for the Altavia project (Mars United Commerce, VML, Acosta Group,
 * Advantage Solutions, CROSSMARK, Momentum Worldwide, GOcxm, Pigeon Brands)
 * but never linked through Competitor Watch, so the daily Competitive report
 * listed them as Gershon's own competitors. Olivier, 2026-11-02: "Why do I
 * have Pigeon Brands … VML as competitors? Mistake?"
 *
 * Merges their ids into OrgSetting `competitors:<Altavia id>` — the same store
 * the Competitor Watch tab writes. Idempotent, marker-guarded, never throws.
 */
import prisma from "@/lib/db-raw";
import { getCompetitorIds, setCompetitorIds } from "@/lib/competitors/store";

const MARKER = "altavia_competitors_linked";
const NAMES = ["Mars United Commerce", "VML", "Acosta Group", "Advantage Solutions", "CROSSMARK", "Momentum Worldwide", "GOcxm", "Pigeon Brands"];
let done = false;

export async function linkAltaviaCompetitors(): Promise<void> {
  if (done) return;
  try {
    const org = await prisma.organization.findFirst({ where: { isPrimary: true }, select: { id: true } });
    if (!org) return;
    const marker = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: org.id, key: MARKER } } });
    if (marker) {
      done = true;
      return;
    }
    const altavia = await prisma.client.findFirst({ where: { organizationId: org.id, name: { contains: "Altavia", mode: "insensitive" }, archivedAt: null }, select: { id: true } });
    if (!altavia) return;
    const comps = await prisma.client.findMany({
      where: { organizationId: org.id, clientType: "COMPETITION", OR: NAMES.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })) },
      select: { id: true },
    });
    if (!comps.length) return;
    const current = await getCompetitorIds(org.id, altavia.id);
    await setCompetitorIds(org.id, altavia.id, [...current, ...comps.map((c) => c.id)]);
    await prisma.orgSetting.create({ data: { organizationId: org.id, key: MARKER, value: JSON.stringify({ at: new Date().toISOString(), linked: comps.length }) } });
    done = true;
  } catch {
    /* best effort — retried on the next run */
  }
}
