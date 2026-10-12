export const runtime = "edge";
/**
 * POST /api/publishing/suggest-x — Intelligence writes the X version of a post.
 * (v4.40.0)
 *
 * Body: { text: string }  (the LinkedIn / main text)
 * Answer: { text, length, max, model, trimmed }
 *
 * Uses the app's Intelligence (Cloudflare Workers AI, lib/content/provider).
 * The limit is the workspace's own X limit (280, or 25,000 with long posts on),
 * counted the way X counts it (lib/publishing xLength: links = 23). The model
 * gets up to three tries; each retry is told exactly how long its last answer
 * was. If it still overshoots, the answer is cut at the last full sentence that
 * fits, keeping the hashtags — so what comes back ALWAYS fits.
 */
import { NextRequest, NextResponse } from "next/server";
import { publishingCaller } from "@/lib/publishing-auth";
import { getSettings, xLength, xMax } from "@/lib/publishing";
import { getAISettings, runChat } from "@/lib/content/provider";

function clean(s: string): string {
  return s
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/, "")
    .replace(/^(here('|’)s|here is)[^:\n]*:\s*/i, "")
    .replace(/^["“]([\s\S]*)["”]$/, "$1")
    .trim();
}

/** Last resort: whole sentences that fit, then the hashtags that still fit. */
function fitTo(text: string, max: number): string {
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

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  try {
    const b = (await req.json().catch(() => null)) as { text?: string } | null;
    const source = (b?.text || "").replace(/\r\n/g, "\n").trim();
    if (!source) return NextResponse.json({ success: false, error: "Write the main post first." }, { status: 400 });

    const max = xMax(await getSettings(c.orgId));
    const target = Math.min(max, max <= 280 ? 270 : max);
    const system = `You rewrite B2B LinkedIn posts as a post for X (Twitter).
Rules:
- At most ${target} characters in total, counting spaces, emoji and hashtags. Links count as 23 characters.
- US English. Same facts, same voice; no invented numbers, names or claims.
- One tight message: the hook, the key point, and one hashtag or two at the end.
- No thread numbering, no quotation marks around the answer, no preamble.
Answer with the X post text only.`;

    const settings = await getAISettings();
    let best = "";
    let model = "";
    let user = source;
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await runChat(settings, system, user, 400);
      model = out.model;
      const t = clean(out.text);
      if (!t) continue;
      if (!best || xLength(t) < xLength(best)) best = t;
      if (xLength(t) <= max) {
        return NextResponse.json({ success: true, data: { text: t, length: xLength(t), max, model, trimmed: false } });
      }
      user = `${source}\n\n---\nYour last answer was ${xLength(t)} characters, the limit is ${target}. Rewrite it shorter:\n${t}`;
    }
    if (!best) return NextResponse.json({ success: false, error: "Intelligence gave no answer. Try again." }, { status: 502 });
    const fitted = fitTo(best, max);
    return NextResponse.json({ success: true, data: { text: fitted, length: xLength(fitted), max, model, trimmed: true } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
