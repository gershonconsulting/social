/**
 * "Draft it" (v4.70.0): writes the post, comment or connection note an action
 * card asks for, in the voice of the company it is for. Cloudflare Workers AI
 * only (Olivier's 2026-10-04 decision); a plain template when AI is down so
 * the button never comes back empty.
 */
import { getAISettings, runChat } from "@/lib/content/provider";
import { aboutOf } from "@/lib/reports/ops/intelligence";
import type { ActionCard } from "./store";

const RULES = `Write in US English for a US B2B audience. No hashtag spam (at most 3, only for a post). No emojis unless they add meaning. Never invent numbers, clients or facts that are not given. Answer with the text only — no title, no quotes around it, no explanation.`;

function prompt(c: ActionCard, about: string | null): { system: string; user: string; max: number } {
  const ctx = `Company: ${c.forCompany}${about ? ` — ${about}` : ""}\nAction: ${c.action}\nWhy: ${c.why}\nBased on: ${c.basedOn}`;
  if (c.pillar === "ENGAGE") {
    return { system: `You write LinkedIn comments for ${c.forCompany}. A good comment adds a point of view or a question, 1-3 sentences, never "Great post!". ${RULES}`, user: `${ctx}\n\nWrite the comment.`, max: 300 };
  }
  if (c.pillar === "NETWORK") {
    return { system: `You write short LinkedIn outreach notes for ${c.forCompany}: personal, specific, under 300 characters, ending with a light question or proposal. ${RULES}`, user: `${ctx}\n\nWrite the note.`, max: 300 };
  }
  return { system: `You write LinkedIn posts for ${c.forCompany}: a strong first line, 120-200 words, short paragraphs, one clear takeaway, a soft call to action. ${RULES}`, user: `${ctx}\n\nWrite the post.`, max: 900 };
}

function template(c: ActionCard): string {
  if (c.pillar === "ENGAGE") return `Interesting angle — at ${c.forCompany} we see the same thing with the companies we work with. What has been the biggest surprise for you so far?`;
  if (c.pillar === "NETWORK") return `Hi — I saw your recent post and thought of ${c.forCompany}. We work on similar topics; would you be open to a short call to compare notes?`;
  return `${c.action}\n\n${c.why}\n\n(Draft written without Intelligence — edit before posting.)`;
}

export async function draftFor(c: ActionCard, industry: string | null): Promise<{ text: string; ai: boolean }> {
  try {
    const settings = await getAISettings();
    if (!settings.available) throw new Error("AI not available");
    const p = prompt(c, aboutOf(c.forCompany, industry));
    const out = await runChat(settings, p.system, p.user, p.max);
    const text = out.text.trim().replace(/^["“]|["”]$/g, "").trim();
    if (!text) throw new Error("empty");
    return { text: text.slice(0, 3000), ai: true };
  } catch {
    return { text: template(c), ai: false };
  }
}
