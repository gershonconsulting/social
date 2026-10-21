/**
 * Lenient JSON for model answers (v4.56.0). Workers AI models sometimes put a
 * raw line break or tab inside a string ("Bad control character in string
 * literal"), wrap the object in prose or a code fence, or leave a trailing
 * comma. parseModelJson() fixes those and parses; it throws only when there is
 * no object at all.
 */
function escapeControlCharsInStrings(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const candidates = [trimmed];
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    for (const v of [c, escapeControlCharsInStrings(c), escapeControlCharsInStrings(c).replace(/,\s*([}\]])/g, "$1")]) {
      try { return JSON.parse(v); } catch { /* next */ }
    }
  }
  throw new Error("Model did not return parseable JSON.");
}
