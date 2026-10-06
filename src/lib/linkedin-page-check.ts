/**
 * Does the LinkedIn page a link opened belong to the company we track?
 *
 * The extension (0.13.2+) sends the name printed on the page with each post
 * (rawPayload.pageName). A name that shares nothing with the tracked company's
 * name means the link opens somebody else's page; the connection is then marked
 * PAGE_MISMATCH and listed in the daily report under "LinkedIn links to fix".
 *
 * Deliberately lenient: legal suffixes, punctuation, accents and word order are
 * ignored, and one shared distinctive word is enough. It catches a link that
 * opens a different company; it cannot catch a different company that happens
 * to carry the same name.
 */

export const PAGE_UNAVAILABLE = "PAGE_UNAVAILABLE";
export const PAGE_MISMATCH = "PAGE_MISMATCH";

const STOP = new Set([
  "the", "and", "of", "inc", "llc", "ltd", "limited", "corp", "corporation", "company", "co",
  "sa", "sas", "sarl", "gmbh", "ag", "bv", "nv", "plc", "spa", "srl", "ab", "oy", "as", "pty",
  "group", "groupe", "holding", "holdings", "international", "global", "usa", "us", "america",
  "official", "page", "linkedin",
]);

function words(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

export function pageNameMatches(trackedName: string, pageName: string): boolean {
  const a = words(trackedName);
  const b = words(pageName);
  if (!a.length || !b.length) return true; // nothing to compare — do not accuse
  const ja = a.join("");
  const jb = b.join("");
  if (ja.includes(jb) || jb.includes(ja)) return true;
  const set = new Set(a.filter((w) => w.length >= 3));
  return b.some((w) => w.length >= 3 && set.has(w));
}

export function isPageProblem(err: string | null | undefined): boolean {
  return !!err && (err.startsWith(PAGE_UNAVAILABLE) || err.startsWith(PAGE_MISMATCH));
}
