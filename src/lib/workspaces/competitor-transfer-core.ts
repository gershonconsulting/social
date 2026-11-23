/**
 * v4.86.0 — pure helpers for sending a client's competitors from the Gershon
 * workspace into that client's OWN workspace. No database access here, so it
 * can be unit-tested.
 */

export type TargetCompany = { id: string; name: string; clientType: string };

/** Lower-case, accents and punctuation stripped, company suffixes dropped. */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|srl|sa|sas|ag|gmbh|corp|corporation|co|company|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Which company in the target workspace IS the client (the one whose
 * Competitor Watch gets the competitors). Order: explicit id → mirror of the
 * Gershon company → same name, preferring INTERNAL → the only INTERNAL company.
 */
export function pickTargetCompany(opts: {
  sourceId: string;
  sourceName: string;
  explicitId?: string;
  mirrorSourceByTarget: Map<string, string>;
  companies: TargetCompany[];
}): { company: TargetCompany | null; reason: string } {
  const { companies } = opts;
  if (opts.explicitId) {
    const c = companies.find((x) => x.id === opts.explicitId) ?? null;
    return { company: c, reason: c ? "explicit" : "explicit id not in workspace" };
  }
  const mirrored = companies.find((c) => opts.mirrorSourceByTarget.get(c.id) === opts.sourceId);
  if (mirrored) return { company: mirrored, reason: "mirror" };

  const want = normName(opts.sourceName);
  const same = companies.filter((c) => c.clientType !== "COMPETITION" && normName(c.name) === want);
  const sameInternal = same.find((c) => c.clientType === "INTERNAL");
  if (sameInternal) return { company: sameInternal, reason: "name (internal)" };
  if (same.length) return { company: same[0], reason: "name" };

  const prefix = companies.filter((c) => {
    if (c.clientType === "COMPETITION") return false;
    const n = normName(c.name);
    if (n.length < 4 || want.length < 4) return false;
    return n.startsWith(want) || want.startsWith(n);
  });
  if (prefix.length === 1) return { company: prefix[0], reason: "name (prefix)" };

  const internals = companies.filter((c) => c.clientType === "INTERNAL");
  if (internals.length === 1) return { company: internals[0], reason: "only internal company" };
  return { company: null, reason: "no matching company" };
}

/** Existing competitor of the same name already in the target workspace → reuse it. */
export function findExistingByName(name: string, companies: TargetCompany[]): TargetCompany | null {
  const want = normName(name);
  return companies.find((c) => normName(c.name) === want) ?? null;
}

/** Merge competitor ids, existing first, no duplicates, never the company itself, max 25. */
export function mergeCompetitorIds(existing: string[], added: string[], selfId: string): string[] {
  return Array.from(new Set([...existing, ...added])).filter((id) => id !== selfId).slice(0, 25);
}
