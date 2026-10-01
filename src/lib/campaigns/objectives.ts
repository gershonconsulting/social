/**
 * Campaign posting objectives — posts per week, per campaign company.
 *
 * Olivier, 2026-10-01: "We have a 5 post per week objective … it should be in
 * the settings, 5 per week by default, but we have cases like WALLIX where it
 * is 3 a week."
 *
 * Stored per workspace in OrgSetting `posting_objectives` (no schema change):
 *   { "default": 5, "companies": { "<clientId>": 3, … } }
 * Edited in Settings → Campaign posting objectives.
 *
 * A month's objective = posts-per-week × days-in-month / 7, rounded
 * (September: 5/week → 21 posts; 3/week → 13). Every published post on
 * LinkedIn or X counts toward it.
 */
import rawDb from "@/lib/db-raw";

export const DEFAULT_PER_WEEK = 5;
const KEY = "posting_objectives";

/** First-time values, applied once when the setting has never been saved. */
const INITIAL_BY_NAME: Array<{ re: RegExp; perWeek: number }> = [{ re: /\bwallix\b/i, perWeek: 3 }];

export interface Objectives {
  default: number;
  companies: Record<string, number>;
}

function clean(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 && v <= 50 ? Math.round(v * 10) / 10 : null;
}

export async function readObjectives(orgId: string): Promise<Objectives | null> {
  const row = await rawDb.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: KEY } } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value);
    const companies: Record<string, number> = {};
    for (const [id, n] of Object.entries(v?.companies || {})) { const c = clean(n); if (c) companies[id] = c; }
    return { default: clean(v?.default) || DEFAULT_PER_WEEK, companies };
  } catch {
    return null;
  }
}

export async function saveObjectives(orgId: string, o: Objectives): Promise<void> {
  const value = JSON.stringify({ default: clean(o.default) || DEFAULT_PER_WEEK, companies: o.companies });
  await rawDb.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: KEY } },
    update: { value },
    create: { organizationId: orgId, key: KEY, value },
  });
}

/**
 * Objectives for a workspace's campaign companies. On first use (nothing ever
 * saved) the known exceptions — WALLIX at 3 a week — are written once, so the
 * Settings card shows them and they can be changed from there.
 */
export async function objectivesFor(orgId: string, campaigns: Array<{ id: string; name: string }>): Promise<{ perWeek: (id: string) => number; o: Objectives }> {
  let o = await readObjectives(orgId);
  if (!o) {
    o = { default: DEFAULT_PER_WEEK, companies: {} };
    for (const c of campaigns) {
      const hit = INITIAL_BY_NAME.find((x) => x.re.test(c.name));
      if (hit) o.companies[c.id] = hit.perWeek;
    }
    try { await saveObjectives(orgId, o); } catch { /* read-only context — still use the values */ }
  }
  const obj = o;
  return { perWeek: (id: string) => obj.companies[id] ?? obj.default, o: obj };
}

export function monthTarget(perWeek: number, daysInMonth: number): number {
  return Math.max(1, Math.round((perWeek * daysInMonth) / 7));
}
