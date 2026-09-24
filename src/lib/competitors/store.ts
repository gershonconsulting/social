/**
 * Competitor links — which companies are tracked as competitors OF a company.
 *
 * Stored per workspace in OrgSetting (`competitors:<clientId>` → JSON array of
 * client ids) rather than a new table: no schema migration, no new scoped
 * model, and the list is tiny (a handful of ids per company). The competitor
 * companies themselves are ordinary Client rows (category COMPETITION) with a
 * LinkedIn / X connection, so the existing Chrome extension collects their
 * posts exactly like any other company.
 */

import rawDb from "@/lib/db-raw";
import { getCurrentOrgId } from "@/lib/scoped-db";

const keyFor = (clientId: string) => `competitors:${clientId}`;

export async function requireOrgId(): Promise<string> {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error("NO_ORGANIZATION");
  return orgId;
}

export async function getCompetitorIds(orgId: string, clientId: string): Promise<string[]> {
  const row = await rawDb.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: keyFor(clientId) } },
  });
  if (!row) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function setCompetitorIds(orgId: string, clientId: string, ids: string[]): Promise<void> {
  const value = JSON.stringify(Array.from(new Set(ids)).slice(0, 25));
  await rawDb.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: keyFor(clientId) } },
    update: { value },
    create: { organizationId: orgId, key: keyFor(clientId), value },
  });
}

/** Cached AI brief, one per company per window. */
const briefKey = (clientId: string, windowDays: number) => `competitor-brief:${clientId}:${windowDays}`;

export async function getBrief(orgId: string, clientId: string, windowDays: number) {
  const row = await rawDb.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: briefKey(clientId, windowDays) } },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function saveBrief(orgId: string, clientId: string, windowDays: number, data: unknown) {
  const value = JSON.stringify(data);
  await rawDb.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: briefKey(clientId, windowDays) } },
    update: { value },
    create: { organizationId: orgId, key: briefKey(clientId, windowDays), value },
  });
}
