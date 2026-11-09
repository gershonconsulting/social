/**
 * One subject format for every report e-mail (Olivier, 2026-11-09):
 *
 *   Social.gershon.ai — <Company name> — <Type> report
 *
 * e.g. "Social.gershon.ai — WALLIX — Company report",
 *      "Social.gershon.ai — Gershon Consulting — Client report",
 *      "Social.gershon.ai — Gershon Consulting — Competitive report".
 */
export const SOCIAL_BRAND = "Social.gershon.ai";

export function socialSubject(company: string | null | undefined, type: string): string {
  const name = (company || "").trim() || "Gershon Consulting";
  return `${SOCIAL_BRAND} — ${name} — ${type}`;
}

/** Monthly category report → its report type. */
const CATEGORY_TYPE: Record<string, string> = {
  CAMPAIGN: "Campaign report",
  CLIENT: "Client report",
  PARTNER: "Partner report",
  PROSPECT: "Prospect report",
  INTERNAL: "Internal report",
  COMPANY: "Companies report",
  COMPETITION: "Competitive report",
  RECYCLED: "Recycled report",
};
export function categoryReportType(key: string, label?: string): string {
  return CATEGORY_TYPE[key] || `${label || key} report`;
}
