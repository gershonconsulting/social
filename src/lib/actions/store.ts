/**
 * Action cards (v4.70.0) — the Competitive / Intelligence reports turned into
 * things to DO, per workspace.
 *
 * Olivier, 2026-11-04: "The social competitive report is a great tool. We
 * should have that for all users on social.gershon.ai. How can we turn this
 * knowledge into actions?" — chose to build it all at once.
 *
 * Every day's Intelligence run is turned into cards in the three campaign
 * pillars (Promote / Network / Engage). Each card has a status (open / done /
 * dismissed) that can be changed with one click from the email (signed link,
 * no sign-in) or from the /actions page, and an optional draft (post text,
 * comment, connection note). A week later the report shows what was done and
 * whether the company's own posting moved.
 *
 * Stored in OrgSetting "intel_actions" (JSON, newest first, capped) — no
 * schema change. Always written with an explicit organizationId through the
 * raw client, because the daily cron has no session.
 */
import rawDb from "@/lib/db-raw";

export type Pillar = "PROMOTE" | "NETWORK" | "ENGAGE";
export type ActionStatus = "open" | "done" | "dismissed";
export type Priority = "high" | "medium" | "low";

export type ActionCard = {
  id: string;
  dayKey: string;
  pillar: Pillar;
  priority: Priority;
  forCompany: string;
  forCompanyId: string | null;
  action: string;
  why: string;
  basedOn: string;
  links: Array<{ label: string; href: string }>;
  /** The post / comment / note to use. Filled by Intelligence for Engage, on demand for the rest. */
  draft: string | null;
  /** The competitor / partner post the card is about, when there is one. */
  postUrl: string | null;
  status: ActionStatus;
  createdAt: string;
  doneAt: string | null;
  dismissedAt: string | null;
  /** Publish ContentItem id once the draft was sent there. */
  publishItemId: string | null;
};

export const ACTIONS_KEY = "intel_actions";
const MAX_CARDS = 200;

export const PILLAR_LABEL: Record<Pillar, string> = { PROMOTE: "Promote", NETWORK: "Network", ENGAGE: "Engage" };
export const PILLAR_HINT: Record<Pillar, string> = {
  PROMOTE: "Post on what works for them — or on what they leave out",
  NETWORK: "Reach out to the people and partners behind it",
  ENGAGE: "Comment on and share the posts that matter",
};

/** Short stable id: the same action on the same day is the same card, so a re-run never duplicates. */
export function cardId(dayKey: string, pillar: Pillar, text: string): string {
  let h = 0x811c9dc5;
  const s = `${dayKey}|${pillar}|${text.trim().toLowerCase()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${dayKey.replace(/-/g, "")}-${h.toString(36)}`;
}

/** Which pillar an AI action belongs to, from what it asks you to do. */
export function pillarOf(text: string): Pillar {
  const t = text.toLowerCase();
  if (/\b(comment|reply|respond to (their|the) post|like|share|repost|reshare|congratulat\w*|tag)\b/.test(t)) return "ENGAGE";
  if (/\b(reach out|contact|connect|introduc\w*|invite|meet|call|email|message|dm|propose|partner with|co-?host|joint|webinar with|attend|sponsor|book a)\b/.test(t)) return "NETWORK";
  return "PROMOTE";
}

export async function readCards(orgId: string): Promise<ActionCard[]> {
  const row = await rawDb.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key: ACTIONS_KEY } } });
  if (!row?.value) return [];
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? (v as ActionCard[]) : [];
  } catch {
    return [];
  }
}

async function writeCards(orgId: string, cards: ActionCard[]): Promise<void> {
  const value = JSON.stringify(cards.slice(0, MAX_CARDS));
  await rawDb.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: ACTIONS_KEY } },
    create: { organizationId: orgId, key: ACTIONS_KEY, value },
    update: { value },
  });
}

export type NewCard = Omit<ActionCard, "id" | "status" | "createdAt" | "doneAt" | "dismissedAt" | "publishItemId">;

/**
 * Add today's cards. A card that already exists keeps its status and draft —
 * only its links are refreshed. Returns the cards for this run, in the order given.
 */
export async function recordCards(orgId: string, fresh: NewCard[]): Promise<ActionCard[]> {
  const existing = await readCards(orgId);
  const byId = new Map(existing.map((c) => [c.id, c]));
  const out: ActionCard[] = [];
  const now = new Date().toISOString();
  for (const n of fresh) {
    const id = cardId(n.dayKey, n.pillar, n.action);
    const prev = byId.get(id);
    const card: ActionCard = prev
      ? { ...prev, links: n.links, forCompanyId: prev.forCompanyId || n.forCompanyId, draft: prev.draft || n.draft }
      : { ...n, id, status: "open", createdAt: now, doneAt: null, dismissedAt: null, publishItemId: null };
    byId.set(id, card);
    if (!out.some((c) => c.id === id)) out.push(card);
  }
  const ids = new Set(out.map((c) => c.id));
  await writeCards(orgId, [...out, ...existing.filter((c) => !ids.has(c.id))]);
  return out;
}

export async function updateCard(orgId: string, id: string, patch: Partial<Pick<ActionCard, "status" | "draft" | "publishItemId">>): Promise<ActionCard | null> {
  const cards = await readCards(orgId);
  const i = cards.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const c = { ...cards[i], ...patch };
  if (patch.status) {
    const now = new Date().toISOString();
    c.doneAt = patch.status === "done" ? cards[i].doneAt || now : null;
    c.dismissedAt = patch.status === "dismissed" ? cards[i].dismissedAt || now : null;
  }
  cards[i] = c;
  await writeCards(orgId, cards);
  return c;
}
