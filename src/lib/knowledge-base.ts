/**
 * Knowledge Base (v4.51.0) — the three things a good campaign is built on
 * (Olivier, 2026-10-18):
 *   1. VALUE PROP — what the company we write for sells, to whom, and why it wins;
 *   2. COMPETITIVE LANDSCAPE — what its competitors post about (live, from the
 *      collected posts of the companies linked in Competitor Watch) + notes;
 *   3. ICPs — the ideal customer profiles we target (several per company).
 *
 * Every company in Publishing (CAMPAIGN + INTERNAL) has one. Autopilot reads
 * it before writing: each post speaks to one ICP, carries the value prop, and
 * answers or out-flanks what competitors are posting. An empty section is
 * drafted by Intelligence (Cloudflare Workers AI) from the company's own
 * posts, description and competitors — marked "AI draft" until edited.
 *
 * Stored per company in OrgSetting `kb:<clientId>` (JSON) — no schema change.
 */
import prisma from "@/lib/db-raw";
import { getAISettings, runChat } from "@/lib/content/provider";
import { buildCompetitorWatch } from "@/lib/competitors/analyze";
import { getCompetitorIds } from "@/lib/competitors/store";
import { aboutOf } from "@/lib/reports/ops/intelligence";

export type Source = "ai" | "manual";
export type Icp = { id: string; name: string; description: string; source: Source; updatedAt: string; from?: string };
export type KnowledgeBase = {
  valueProp: { text: string; source: Source; updatedAt: string | null };
  competitive: { notes: string; source: Source; updatedAt: string | null };
  icps: Icp[];
};
const EMPTY: KnowledgeBase = {
  valueProp: { text: "", source: "manual", updatedAt: null },
  competitive: { notes: "", source: "manual", updatedAt: null },
  icps: [],
};
const key = (clientId: string) => `kb:${clientId}`;
const DAY = 86400000;
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export async function getKB(orgId: string, clientId: string): Promise<KnowledgeBase> {
  const row = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: key(clientId) } } });
  if (!row?.value) return structuredClone(EMPTY);
  try {
    const v = JSON.parse(row.value) as Partial<KnowledgeBase>;
    return {
      valueProp: { ...EMPTY.valueProp, ...(v.valueProp || {}) },
      competitive: { ...EMPTY.competitive, ...(v.competitive || {}) },
      icps: Array.isArray(v.icps) ? v.icps.filter((i) => i && i.name).slice(0, 12) : [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function saveKB(orgId: string, clientId: string, kb: KnowledgeBase): Promise<KnowledgeBase> {
  const clean: KnowledgeBase = {
    valueProp: { text: String(kb.valueProp?.text || "").slice(0, 6000), source: kb.valueProp?.source === "ai" ? "ai" : "manual", updatedAt: kb.valueProp?.updatedAt || new Date().toISOString() },
    competitive: { notes: String(kb.competitive?.notes || "").slice(0, 6000), source: kb.competitive?.source === "ai" ? "ai" : "manual", updatedAt: kb.competitive?.updatedAt || new Date().toISOString() },
    icps: (kb.icps || []).slice(0, 12).map((i) => ({
      id: i.id || newId(),
      name: String(i.name || "").trim().slice(0, 120) || "ICP",
      description: String(i.description || "").slice(0, 4000),
      source: i.source === "ai" ? "ai" : "manual",
      updatedAt: i.updatedAt || new Date().toISOString(),
      ...(i.from ? { from: String(i.from).slice(0, 160) } : {}),
    })),
  };
  const value = JSON.stringify(clean);
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: key(clientId) } },
    create: { organizationId: orgId, key: key(clientId), value },
    update: { value },
  });
  return clean;
}

function newId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ── Competitive landscape (live) ─────────────────────────────────────────────

export type CompetitiveSnapshot = {
  competitors: Array<{ id: string; name: string; posts: number; perWeek: number; topThemes: string[]; keywords: string[] }>;
  themes: Array<{ label: string; self: number; competitors: number }>;
  gaps: string[];
  owned: string[];
  topPosts: Array<{ company: string; date: string; text: string; engagement: number; url: string | null }>;
  linkedVia: "competitor-watch" | "workspace-competition" | "none";
  windowDays: number;
};

/**
 * The companies tracked as competitors of this one. Competitor Watch links
 * first; for Gershon's own (INTERNAL) brands with no links, the workspace's
 * COMPETITION companies — they are Gershon's market.
 */
async function competitorsOf(orgId: string, clientId: string) {
  const ids = await getCompetitorIds(orgId, clientId);
  if (ids.length) {
    const rows = await prisma.client.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, name: true } });
    return { rows, via: "competitor-watch" as const };
  }
  const self = await prisma.client.findFirst({ where: { id: clientId }, select: { clientType: true, name: true } });
  if (self?.clientType === "INTERNAL" && /gershon/i.test(self.name)) {
    const rows = await prisma.client.findMany({
      where: { organizationId: orgId, clientType: "COMPETITION", archivedAt: null },
      select: { id: true, name: true },
      take: 10,
    });
    if (rows.length) return { rows, via: "workspace-competition" as const };
  }
  return { rows: [] as { id: string; name: string }[], via: "none" as const };
}

export async function competitiveSnapshot(orgId: string, clientId: string, windowDays = 90): Promise<CompetitiveSnapshot> {
  const self = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true, name: true } });
  const { rows, via } = await competitorsOf(orgId, clientId);
  if (!self || !rows.length) return { competitors: [], themes: [], gaps: [], owned: [], topPosts: [], linkedVia: via, windowDays };
  const w = await buildCompetitorWatch(self, rows.slice(0, 8), windowDays);
  return {
    competitors: w.competitors.map((c) => ({
      id: c.id,
      name: c.name,
      posts: c.postCount,
      perWeek: c.postsPerWeek,
      topThemes: c.themes.filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 3).map((t) => t.label),
      keywords: c.keywords.slice(0, 8).map((k) => k.term),
    })),
    themes: w.themeComparison.filter((t) => t.self || t.competitors).map((t) => ({ label: t.label, self: t.self, competitors: t.competitors })),
    gaps: w.gaps.slice(0, 12).map((g) => g.term),
    owned: w.owned.slice(0, 10).map((k) => k.term),
    topPosts: w.competitors
      .flatMap((c) => c.topPosts.slice(0, 2).map((p) => ({ company: c.name, date: p.date, text: p.text.slice(0, 400), engagement: p.engagement, url: p.url })))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 6),
    linkedVia: via,
    windowDays,
  };
}

/** A few lines for an AI prompt. */
export function snapshotForPrompt(s: CompetitiveSnapshot): string {
  if (!s.competitors.length) return "";
  const lines = [
    `Competitors tracked: ${s.competitors.map((c) => `${c.name} (${c.perWeek}/week; talks about ${c.topThemes.join(", ") || "—"}; words: ${c.keywords.slice(0, 5).join(", ")})`).join("; ")}.`,
  ];
  if (s.gaps.length) lines.push(`Topics competitors cover that we never do: ${s.gaps.slice(0, 8).join(", ")}.`);
  if (s.owned.length) lines.push(`Topics we own (competitors don't use): ${s.owned.slice(0, 6).join(", ")}.`);
  if (s.topPosts.length) lines.push(`Their best posts lately:\n${s.topPosts.slice(0, 3).map((p) => `- ${p.company}: ${p.text.slice(0, 200)}`).join("\n")}`);
  return lines.join("\n");
}

// ── Intelligence drafts ──────────────────────────────────────────────────────

export type Section = "valueProp" | "competitive" | "icps" | "all";

async function ownPosts(clientId: string): Promise<string[]> {
  const rows = await prisma.socialPost.findMany({
    where: { clientId, publishedAtUtc: { gte: new Date(Date.now() - 180 * DAY) } },
    select: { postTextFull: true, postTextSnippet: true, likeCount: true, commentCount: true, shareCount: true },
    orderBy: { publishedAtUtc: "desc" },
    take: 80,
  });
  return rows
    .map((p) => ({ t: (p.postTextFull || p.postTextSnippet || "").trim(), e: p.likeCount + p.commentCount * 3 + p.shareCount * 5 }))
    .filter((p) => p.t.length > 60)
    .sort((a, b) => b.e - a.e)
    .slice(0, 12)
    .map((p) => p.t.slice(0, 450));
}

/**
 * Draft one section (or all empty ones) with Intelligence. `overwrite` = false
 * keeps whatever is already written; true replaces the asked section.
 */
export async function draftKB(orgId: string, clientId: string, section: Section = "all", overwrite = false): Promise<KnowledgeBase> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: orgId },
    select: { name: true, industry: true, website: true, notes: true },
  });
  if (!client) throw new Error("Company not found");
  const kb = await getKB(orgId, clientId);
  const want = {
    valueProp: (section === "all" || section === "valueProp") && (overwrite || !kb.valueProp.text.trim()),
    competitive: (section === "all" || section === "competitive") && (overwrite || !kb.competitive.notes.trim()),
    icps: (section === "all" || section === "icps") && (overwrite || !kb.icps.length),
  };
  if (!want.valueProp && !want.competitive && !want.icps) return kb;

  const about = aboutOf(client.name, client.industry) || client.notes?.slice(0, 400) || null;
  const posts = await ownPosts(clientId);
  const snap = await competitiveSnapshot(orgId, clientId).catch(() => null);
  const system = `You are a B2B marketing strategist preparing the campaign knowledge base of ${client.name}${client.website ? ` (${client.website})` : ""}.
${about ? `What it does: ${about}.` : "Use only what the company's own posts show about what it does; never guess beyond them."}
The campaigns target the US market. US English. Be specific and concrete; no buzzwords. Never invent numbers, client names, awards or results.
Answer ONLY with a JSON object:
{
  "valueProp": string,   // 4-8 short lines: one-sentence positioning; who it is for; the problem; how it solves it; 3 proof points or differentiators (only ones supported by the material, otherwise say what to confirm); the one-line promise
  "competitive": string, // 4-8 short lines: who the competitors are and what they post about; the topics they own; the gaps we can take; how ${client.name} should position against them
  "icps": [ { "name": string, "description": string } ]  // exactly 3 ICPs. name = "<Job title> at <company type>". description = 5 short lines: Company (industry, size, US region if relevant) · Role & seniority · Pains · Triggers to buy now · What they need to hear from us
}`;
  const user = [
    posts.length ? `Our recent posts that performed best:\n---\n${posts.join("\n---\n")}` : "We have no collected posts yet.",
    snap && snap.competitors.length ? `\nCompetitive data from collected posts:\n${snapshotForPrompt(snap)}` : "\nNo competitors are tracked yet — say which competitor types to track.",
    kb.valueProp.text && !want.valueProp ? `\nOur value proposition (already validated, build on it):\n${kb.valueProp.text}` : "",
    kb.icps.length && !want.icps ? `\nOur ICPs (already validated):\n${kb.icps.map((i) => `- ${i.name}: ${i.description.slice(0, 200)}`).join("\n")}` : "",
  ].join("\n");

  const ai = { ...(await getAISettings()), model: MODEL };
  let parsed: { valueProp?: string; competitive?: string; icps?: Array<{ name?: string; description?: string }> } | null = null;
  for (let i = 0; i < 2 && !parsed; i++) {
    const out = await runChat(ai, system, user, 2500);
    const a = out.text.indexOf("{"), b = out.text.lastIndexOf("}");
    try {
      parsed = JSON.parse(out.text.slice(a, b + 1));
    } catch {
      parsed = null;
    }
  }
  if (!parsed) throw new Error("Intelligence gave no readable answer. Try again.");
  const now = new Date().toISOString();
  const str = (v: unknown) => (Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : "").trim();
  if (want.valueProp && str(parsed.valueProp)) kb.valueProp = { text: str(parsed.valueProp), source: "ai", updatedAt: now };
  if (want.competitive && str(parsed.competitive)) kb.competitive = { notes: str(parsed.competitive), source: "ai", updatedAt: now };
  if (want.icps && Array.isArray(parsed.icps) && parsed.icps.length) {
    kb.icps = parsed.icps
      .filter((i) => i && i.name)
      .slice(0, 5)
      .map((i) => ({ id: newId(), name: String(i.name).slice(0, 120), description: str(i.description), source: "ai" as const, updatedAt: now }));
  }
  return saveKB(orgId, clientId, kb);
}

/** The knowledge base as prompt text for writing posts. ICP picked by the caller. */
export function kbForPrompt(kb: KnowledgeBase): string {
  const out: string[] = [];
  if (kb.valueProp.text.trim()) out.push(`VALUE PROPOSITION:\n${kb.valueProp.text.trim().slice(0, 1500)}`);
  if (kb.competitive.notes.trim()) out.push(`COMPETITIVE POSITIONING:\n${kb.competitive.notes.trim().slice(0, 1200)}`);
  return out.join("\n\n");
}

// ── ICP upload (v4.53.0) ─────────────────────────────────────────────────────
//
// Olivier, 2026-10-18: "I need to be able to upload ICP information somewhere
// for the campaign." A file (PDF, Word, Excel, CSV, text) or pasted text is
// turned into text (Workers AI toMarkdown for documents), Intelligence pulls
// the ICPs out of it, and they are ADDED to the company's ICPs (an ICP with
// the same name is replaced). The text itself is kept (kb-doc:<clientId>:…)
// so the source of each ICP stays visible.

type ToMarkdown = { toMarkdown?: (docs: Array<{ name: string; blob: Blob }>) => Promise<Array<{ data?: string; format?: string; error?: string }>> };

export async function fileToText(name: string, blob: Blob): Promise<string> {
  const lower = name.toLowerCase();
  if (/\.(txt|md|csv|tsv|json)$/.test(lower) || blob.type.startsWith("text/")) return (await blob.text()).slice(0, 60000);
  const { getAIBinding } = await import("@/lib/content/provider");
  const ai = getAIBinding() as unknown as ToMarkdown | null;
  if (!ai?.toMarkdown) throw new Error("This file type can't be read here — upload a PDF, Word or Excel file, or paste the text.");
  const out = await ai.toMarkdown([{ name, blob }]);
  const text = (out?.[0]?.data || "").trim();
  if (!text) throw new Error(out?.[0]?.error || "No text could be read from this file.");
  return text.slice(0, 60000);
}

export async function importIcps(orgId: string, clientId: string, text: string, from: string): Promise<{ kb: KnowledgeBase; added: number }> {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { name: true, industry: true } });
  if (!client) throw new Error("Company not found");
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length < 40) throw new Error("There is not enough text to find an ICP in.");
  const about = aboutOf(client.name, client.industry);
  const ai = { ...(await getAISettings()), model: MODEL };
  const system = `You extract Ideal Customer Profiles (ICPs) for ${client.name}${about ? ` (${about})` : ""} from a document the team uploaded.
Keep ONLY what the document says — do not invent industries, sizes, titles or numbers. If the document lists several segments or personas, return one ICP each (max 8).
Answer ONLY with JSON: { "icps": [ { "name": string, "description": string } ] }
name = "<Job title / persona> at <company type>" (or the segment name the document uses).
description = short lines, using what the document gives: Company (industry, size, geography) · Role & seniority · Pains · Triggers to buy now · What they need to hear from us · Any other criteria in the document (budget, tech stack, exclusions…).`;
  let parsed: { icps?: Array<{ name?: string; description?: string }> } | null = null;
  for (let i = 0; i < 2 && !parsed; i++) {
    const out = await runChat(ai, system, `DOCUMENT (${from}):\n${clean.slice(0, 24000)}`, 3000);
    const a = out.text.indexOf("{"), b = out.text.lastIndexOf("}");
    try { parsed = JSON.parse(out.text.slice(a, b + 1)); } catch { parsed = null; }
  }
  const found = (parsed?.icps || []).filter((i) => i && i.name && i.description).slice(0, 8);
  if (!found.length) throw new Error("Intelligence found no ICP in this document.");
  const kb = await getKB(orgId, clientId);
  const now = new Date().toISOString();
  for (const f of found) {
    const name = String(f.name).slice(0, 120);
    const description = Array.isArray(f.description) ? (f.description as unknown[]).join("\n") : String(f.description);
    const icp: Icp = { id: newId(), name, description, source: "ai", updatedAt: now, from };
    const k = kb.icps.findIndex((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (k >= 0) kb.icps[k] = { ...icp, id: kb.icps[k].id };
    else kb.icps.push(icp);
  }
  kb.icps = kb.icps.slice(-12);
  const docKey = `kb-doc:${clientId}:${Date.now()}`;
  await prisma.orgSetting.create({ data: { organizationId: orgId, key: docKey, value: JSON.stringify({ from, uploadedAt: now, text: clean.slice(0, 60000) }) } });
  return { kb: await saveKB(orgId, clientId, kb), added: found.length };
}

/** The ICP documents uploaded for a company (names and dates). */
export async function icpDocs(orgId: string, clientId: string): Promise<Array<{ from: string; uploadedAt: string; chars: number }>> {
  const rows = await prisma.orgSetting.findMany({ where: { organizationId: orgId, key: { startsWith: `kb-doc:${clientId}:` } }, select: { value: true }, take: 30 });
  return rows
    .map((r) => { try { const v = JSON.parse(r.value) as { from: string; uploadedAt: string; text: string }; return { from: v.from, uploadedAt: v.uploadedAt, chars: v.text.length }; } catch { return null; } })
    .filter((x): x is { from: string; uploadedAt: string; chars: number } => !!x)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}
