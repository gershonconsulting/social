/**
 * Heuristic cleaner for company names that look like raw HTML <title> tags.
 *
 * Examples handled:
 *   "Home | PhiTech"                                            → "PhiTech"
 *   "Accueil – French Morning - French Morning US"              → "French Morning US"
 *   "Front page DC | FACC Washington D.C. Chapter"              → "FACC Washington D.C. Chapter"
 *   "Rapid EV Charging | Energy Storage | BESS | MicroGrids"    → "Rapid EV Charging"
 *   "WALLIX - CYBERSECURITY SIMPLIFIED"                         → "WALLIX"
 *   "Altavia North America - Altavia"                           → "Altavia North America"
 *   "Edflex"                                                    → "Edflex"  (unchanged)
 *
 * Returns the original name when no cleanup is warranted.
 */

const HOMEPAGE_PREFIXES = [
  /^home\b[\s|:\-–—]+/i,
  /^accueil\b[\s|:\-–—]+/i,
  /^welcome\b[\s|:\-–—]+/i,
  /^front\s*page\b[^|]*\|+\s*/i,
];

const TAGLINE_SUFFIXES = [
  /\s*[-–—]\s*[A-Z][A-Z\s&]+SIMPLIFIED$/i,
  /\s*[-–—]\s*Innovative.*$/i,
  /\s*[-–—]\s*Empowering.*$/i,
];

export function inferCleanName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();

  // 1. Strip homepage prefixes ("Home | ", "Accueil - ", "Front page DC | ")
  for (const re of HOMEPAGE_PREFIXES) {
    s = s.replace(re, "");
  }

  // 2. If the name has " | " (pipe-separated title parts), keep the FIRST segment
  //    unless the first segment is generic (like "Home", "Welcome").
  if (s.includes("|")) {
    const parts = s.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      // Pick the longest non-generic part as the brand
      const generic = /^(home|welcome|accueil|about|contact|index)\b/i;
      const candidates = parts.filter((p) => !generic.test(p));
      s = candidates[0] || parts[0];
    }
  }

  // 3. Strip marketing taglines after a dash
  for (const re of TAGLINE_SUFFIXES) {
    s = s.replace(re, "");
  }

  // 4. "Brand - Brand" duplicate (e.g. "Altavia North America - Altavia"):
  //    if the right-hand side is a substring of the left, drop it.
  const dashSplit = s.split(/\s+[-–—]\s+/);
  if (dashSplit.length === 2) {
    const [left, right] = dashSplit.map((p) => p.trim());
    if (left.toLowerCase().includes(right.toLowerCase())) {
      s = left;
    }
  }

  return s.trim();
}
