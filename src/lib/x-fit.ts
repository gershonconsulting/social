/**
 * Fitting a post into X's limit (shared by "Suggest X version" and Autopilot).
 * clean() strips model chatter; fitTo() is the last resort that ALWAYS fits.
 */
import { xLength } from "@/lib/publishing";

export function clean(s: string): string {
  return s
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/, "")
    .replace(/^(here('|’)s|here is)[^:\n]*:\s*/i, "")
    .replace(/^["“]([\s\S]*)["”]$/, "$1")
    .trim();
}

/** Last resort: whole sentences that fit, then the hashtags that still fit. */
export function fitTo(text: string, max: number): string {
  if (xLength(text) <= max) return text;
  const tags = (text.match(/#[A-Za-z0-9_\u00C0-\u024F]+/g) || []).slice(0, 3);
  const body = text.replace(/#[A-Za-z0-9_\u00C0-\u024F]+/g, "").replace(/\s+/g, " ").trim();
  const sentences = body.match(/[^.!?]+[.!?]+/g) || [body];
  let out = "";
  for (const s of sentences) {
    const next = (out + " " + s.trim()).trim();
    if (xLength(next) > max) break;
    out = next;
  }
  if (!out) {
    const words = body.split(" ");
    for (const w of words) {
      const next = (out + " " + w).trim();
      if (xLength(next + "…") > max) break;
      out = next;
    }
    out += "…";
  }
  for (const t of tags) {
    if (xLength(out + " " + t) <= max) out += " " + t;
  }
  return out;
}

