/**
 * Publishing Autopilot (v4.51.0) — Gershon's own (INTERNAL) companies post
 * every day without anyone writing a word.
 *
 * v4.56.0 (Olivier, 2026-10-21): CAMPAIGN companies can be added in the
 *   Autopilot section too. Their month goes to the client's validator and is
 *   never auto-approved — nothing is published before the client approves.
 *
 * RULES (Olivier, 2026-10-18):
 *   - Autopilot runs for the INTERNAL companies (Gershon Consulting,
 *     AmericanAbroad, Linalysis, …), not for CAMPAIGN clients.
 *   - ONE POST PER DAY, every day.
 *   - On the 20th of every month the whole NEXT month is ready: AI writes each
 *     day's LinkedIn post, its X version and its picture.
 *   - Olivier gets ONE email with the month to approve (one review link per
 *     company, "Approve all" on each). Whatever he has not answered 48 hours
 *     later is approved automatically. "Changes requested" posts are rewritten
 *     by AI from his comment and sent back to him.
 *   - Approved posts are scheduled on their own day (default 09:30 New York)
 *     and published by the existing Publishing pipeline (Chrome extension +
 *     the 15-minute check that every post really went out).
 *
 * Before the 20th, a run fills the rest of the CURRENT month from three days
 * out — so switching Autopilot on mid-month does not leave a gap.
 *
 * One call of runStep() does a bounded amount of work (a few posts) so each
 * request stays well inside the Cloudflare budget; the daily GitHub Actions
 * workflow (.github/workflows/autopilot.yml) calls it until `remaining` is 0.
 *
 * Planned day = ContentItem.scheduledAt while the post is a draft / in review
 * (the calendar already shows it there). Autopilot posts are the ones with
 * createdBy = "Autopilot". Everything is stored in OrgSetting: no schema change.
 */
import prisma from "@/lib/db-raw";
import { getAIBinding, getAISettings, runChat } from "@/lib/content/provider";
import { objectivesFor, saveObjectives } from "@/lib/campaigns/objectives";
import {
  addEvent, alertTeam, destinationsOf, esc, notifyReadyForPublishing, sendMail, validatorOf, getSettings, getTarget, LINKEDIN_MAX, MEDIA_SELECT, reviewToken, reviewUrl, scheduleItem, SITE, xLength, xMax,
} from "@/lib/publishing";
import { submitForReview } from "@/lib/publishing-review";
import { aboutOf } from "@/lib/reports/ops/intelligence";
import { clean, fitTo } from "@/lib/x-fit";
import { competitiveSnapshot, draftKB, getKB, kbForPrompt, snapshotForPrompt, type KnowledgeBase } from "@/lib/knowledge-base";

export const AUTOPILOT = "Autopilot";
const TZ = "America/New_York";
const DAY = 86400000;
const SETTINGS_KEY = "autopilot_settings";
const TEXT_MODEL_HINT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const IMAGE_MODELS = ["@cf/black-forest-labs/flux-1-schnell", "@cf/bytedance/stable-diffusion-xl-lightning"];

// ── Settings ─────────────────────────────────────────────────────────────────

export type AutopilotSettings = {
  /** null = not decided yet → ON when the workspace has a Gershon INTERNAL company. */
  enabled: boolean | null;
  /** INTERNAL companies Autopilot writes for. null = all of them. */
  clientIds: string[] | null;
  /** "HH:MM", New York time. */
  postTime: string;
  /** Hours after the batch email before unanswered posts are approved. */
  autoApproveHours: number;
  /** Day of the month the next month must be ready. */
  monthDay: number;
};
const DEFAULTS: AutopilotSettings = { enabled: null, clientIds: null, postTime: "09:30", autoApproveHours: 48, monthDay: 20 };

async function readSetting(orgId: string, key: string): Promise<string | null> {
  const r = await prisma.orgSetting.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } });
  return r?.value ?? null;
}
async function writeSetting(orgId: string, key: string, value: string): Promise<void> {
  await prisma.orgSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: { organizationId: orgId, key, value },
    update: { value },
  });
}

export async function getAutopilotSettings(orgId: string): Promise<AutopilotSettings> {
  const raw = await readSetting(orgId, SETTINGS_KEY);
  try {
    return { ...DEFAULTS, ...(raw ? (JSON.parse(raw) as Partial<AutopilotSettings>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
export async function saveAutopilotSettings(orgId: string, patch: Partial<AutopilotSettings>): Promise<AutopilotSettings> {
  const next = { ...(await getAutopilotSettings(orgId)), ...patch };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.postTime)) next.postTime = DEFAULTS.postTime;
  next.autoApproveHours = Math.min(240, Math.max(1, Math.round(Number(next.autoApproveHours) || 48)));
  next.monthDay = Math.min(28, Math.max(1, Math.round(Number(next.monthDay) || 20)));
  if (next.clientIds && !Array.isArray(next.clientIds)) next.clientIds = null;
  await writeSetting(orgId, SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/** Company types Autopilot can write for (v4.56.0: CAMPAIGN companies can be added too). */
export const AUTOPILOT_TYPES: ("INTERNAL" | "CAMPAIGN")[] = ["INTERNAL", "CAMPAIGN"];

/**
 * The companies Autopilot writes for. Not chosen yet (clientIds null) = every
 * INTERNAL company; CAMPAIGN companies are only included when picked.
 */
export async function autopilotClients(orgId: string, s?: AutopilotSettings) {
  const st = s || (await getAutopilotSettings(orgId));
  const all = await prisma.client.findMany({
    where: { organizationId: orgId, clientType: { in: AUTOPILOT_TYPES }, archivedAt: null, status: { not: "ARCHIVED" } },
    select: { id: true, name: true, industry: true, website: true, notes: true, clientType: true },
    orderBy: { name: "asc" },
  });
  return st.clientIds ? all.filter((c) => st.clientIds!.includes(c.id)) : all.filter((c) => c.clientType === "INTERNAL");
}

export async function isEnabled(orgId: string, s?: AutopilotSettings): Promise<boolean> {
  const st = s || (await getAutopilotSettings(orgId));
  if (st.enabled !== null) return st.enabled;
  const g = await prisma.client.count({ where: { organizationId: orgId, clientType: "INTERNAL", name: { contains: "Gershon", mode: "insensitive" } } });
  return g > 0;
}

/** Workspaces where Autopilot is on. */
export async function autopilotOrgs(): Promise<string[]> {
  const rows = await prisma.client.findMany({ where: { clientType: "INTERNAL" }, select: { organizationId: true }, distinct: ["organizationId"] });
  const out: string[] = [];
  for (const r of rows) if (r.organizationId && (await isEnabled(r.organizationId))) out.push(r.organizationId);
  return out;
}

// ── New York dates ───────────────────────────────────────────────────────────

const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export function etYmd(d: Date): string {
  return ymdFmt.format(d);
}
/** The instant of "YYYY-MM-DD HH:MM" New York time. */
export function etInstant(ymd: string, hhmm: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  for (const off of [4, 5]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh + off, mm));
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false }).format(t);
    if (Number(parts) % 24 === hh) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, hh + 5, mm));
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}
function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export type PlanWindow = { days: string[]; label: string; monthKey: string; from: Date; to: Date };

/**
 * Which days must be planned now: from the 20th, the whole next month; before
 * it, the rest of this month from three days out (catch-up when switched on).
 */
export function planWindow(s: AutopilotSettings, now = new Date()): PlanWindow {
  const today = etYmd(now);
  const [y, m, d] = today.split("-").map(Number);
  let start: string, end: string;
  if (d >= s.monthDay) {
    start = new Date(Date.UTC(y, m, 1, 12)).toISOString().slice(0, 10);
    end = new Date(Date.UTC(y, m + 1, 0, 12)).toISOString().slice(0, 10);
  } else {
    // From 3 days out: the 48h approval window fits before the first post.
    start = addDays(today, 3);
    end = new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
  }
  const days: string[] = [];
  for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
  return {
    days,
    label: monthLabel(days[0] || start),
    monthKey: (days[0] || start).slice(0, 7),
    from: etInstant(start, "00:00"),
    to: etInstant(addDays(end, 1), "00:00"),
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** What each weekday's post is, so a month does not read like one post 30 times. */
const DAY_ANGLE = [
  "Sunday: a light, human post — a reflection, a lesson learned or a behind-the-scenes moment",
  "Monday: a sharp insight or a point of view on the market",
  "Tuesday: a practical how-to tip the reader can apply this week",
  "Wednesday: a short story or a typical situation a customer faces (no invented names or numbers)",
  "Thursday: a myth vs. reality, or a common mistake and how to avoid it",
  "Friday: a question to the audience that invites comments",
  "Saturday: a short checklist or 3-point summary",
];

type Draft = { title: string; linkedin: string; x: string; image: string };

function parseDrafts(text: string): Draft[] {
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try {
    const arr = JSON.parse(text.slice(a, b + 1)) as unknown[];
    return arr
      .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {}))
      .map((o) => ({
        title: String(o.title || "").trim().slice(0, 120),
        linkedin: String(o.linkedin || "").replace(/\r\n/g, "\n").trim(),
        x: clean(String(o.x || "")),
        image: String(o.image || "").trim().slice(0, 500),
      }))
      .filter((d) => d.linkedin.length > 80);
  } catch {
    return [];
  }
}

async function companyContext(c: { id: string; name: string; industry: string | null; website: string | null; notes: string | null }) {
  const about = aboutOf(c.name, c.industry) || c.notes?.slice(0, 300) || null;
  const recent = await prisma.socialPost.findMany({
    where: { clientId: c.id, publishedAtUtc: { gte: new Date(Date.now() - 120 * DAY) } },
    select: { postTextFull: true, postTextSnippet: true, likeCount: true, commentCount: true, shareCount: true },
    orderBy: { publishedAtUtc: "desc" },
    take: 60,
  });
  const best = recent
    .map((p) => ({ t: (p.postTextFull || p.postTextSnippet || "").trim(), e: p.likeCount + p.commentCount * 3 + p.shareCount * 5 }))
    .filter((p) => p.t.length > 60)
    .sort((a, b) => b.e - a.e)
    .slice(0, 8)
    .map((p) => p.t.slice(0, 500));
  return { about, website: c.website, examples: best };
}

const SYSTEM = (company: string, about: string | null, website: string | null, xLimit: number) => `You are the senior social-media copywriter of ${company}${website ? ` (${website})` : ""}.
${about ? `What ${company} does: ${about}.` : `Do not guess what ${company} does beyond what its example posts show.`}
You write the company's own daily LinkedIn posts, each with an X (Twitter) version and an image idea.
Audience: decision-makers at US companies (or companies entering the US). US English only.
Rules:
- Each post stands alone and is about ONE idea. Different topic for every post; never repeat a topic listed as already planned.
- LinkedIn post: 500-1,300 characters. A strong first line (the hook), short paragraphs, a concrete takeaway, and a soft call to action (comment, follow, or visit the website). 2-4 relevant hashtags at the end. No emoji walls (at most 2 emoji).
- X version: at most ${Math.min(xLimit, 270)} characters including 1-2 hashtags; same idea, tighter.
- NEVER invent statistics, numbers, client names, quotes, awards, prices or results. If you need a number, use none.
- No clickbait, no "In today's fast-paced world", no "Let's dive in", no "game-changer".
- "image": a description of a photograph that illustrates the post — real-world scene, people or objects, editorial style. It must contain NO text, words, letters, numbers, logos or screens with writing.
Answer ONLY with a JSON array, no prose: [ { "title": string (5-8 words, internal label), "linkedin": string, "x": string, "image": string } ]`;

/** The company's Knowledge Base — drafted by Intelligence the first time it is empty. */
async function knowledge(orgId: string, clientId: string): Promise<KnowledgeBase> {
  let kb = await getKB(orgId, clientId);
  if (!kb.valueProp.text.trim() || !kb.icps.length) {
    try { kb = await draftKB(orgId, clientId, "all", false); } catch { /* write without it */ }
  }
  return kb;
}

async function writePosts(
  orgId: string,
  c: { id: string; name: string; industry: string | null; website: string | null; notes: string | null },
  days: string[],
  avoid: string[],
  xLimit: number,
): Promise<Draft[]> {
  const ctx = await companyContext(c);
  const kb = await knowledge(orgId, c.id);
  const snap = await competitiveSnapshot(orgId, c.id).catch(() => null);
  const target = await getTarget(orgId, c.id);
  const inGroup = destinationsOf(target).some((d) => d.kind === "group");
  const icpFor = (d: string) => (kb.icps.length ? kb.icps[(Number(d.slice(8, 10)) - 1) % kb.icps.length] : null);
  const ai = await getAISettings();
  const settings = { ...ai, model: TEXT_MODEL_HINT };
  const user = [
    `Write ${days.length} post${days.length === 1 ? "" : "s"}, one per day, in this order:`,
    ...days.map((d, i) => {
      const wd = new Date(d + "T12:00:00Z").getUTCDay();
      const icp = icpFor(d);
      return `${i + 1}. ${d} — ${DAY_ANGLE[wd]}${icp ? ` — written for the ICP "${icp.name}"` : ""}`;
    }),
    "",
    inGroup
      ? `CHANNEL: the LinkedIn version is published in the LinkedIn GROUP of ${c.name} (a community of its members), posted by the group's host. Write to the members as a community: useful, conversational, first person plural ("we", "our members"); give real practical value; end with ONE question that invites members to reply or share their own experience. No hard selling; at most a light mention of ${c.website || c.name}. Hashtags: 1-2 at most.`
      : "",
    kbForPrompt(kb),
    kb.icps.length ? `ICPs (each post speaks to the one named for its day — their pains, triggers and language):\n${kb.icps.map((i) => `- ${i.name}: ${i.description.replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}` : "",
    snap && snap.competitors.length ? `COMPETITORS — what they post about (differentiate; take the gaps; never name them negatively):\n${snapshotForPrompt(snap)}` : "",
    avoid.length ? `Topics already planned (do NOT repeat):\n- ${avoid.slice(-40).join("\n- ")}` : "",
    ctx.examples.length ? `\nRecent posts of ${c.name} that did well (match the voice, do not copy):\n---\n${ctx.examples.join("\n---\n")}` : "",
  ].join("\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await runChat(settings, SYSTEM(c.name, ctx.about, ctx.website, xLimit), user, 4000);
    const drafts = parseDrafts(out.text);
    if (drafts.length) return drafts.slice(0, days.length);
  }
  // The model sometimes breaks the JSON on a multi-post answer: one post at a time.
  if (days.length > 1) {
    const one: Draft[] = [];
    for (const d of days) {
      const got = (await writePosts(orgId, c, [d], avoid, xLimit))[0];
      if (!got) break; // keep days in order: the rest is retried on the next call
      one.push(got);
    }
    return one;
  }
  return [];
}

// ── Pictures ─────────────────────────────────────────────────────────────────

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
async function streamBytes(v: unknown): Promise<Uint8Array | null> {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v && typeof (v as ReadableStream).getReader === "function") {
    return new Uint8Array(await new Response(v as ReadableStream).arrayBuffer());
  }
  return null;
}

/** One picture for a post, from Cloudflare Workers AI. JPEG (flux) or PNG (fallback). */
export async function makePicture(idea: string): Promise<{ dataB64: string; mime: string; width: number; height: number } | null> {
  const ai = getAIBinding();
  if (!ai) return null;
  const prompt = `${idea}. Professional editorial photograph, natural light, realistic, high quality, business context. Absolutely no text, no words, no letters, no logos.`;
  for (const model of IMAGE_MODELS) {
    try {
      const out = (await ai.run(model, model.includes("flux") ? { prompt, steps: 6 } : { prompt, width: 1024, height: 1024 })) as unknown;
      if (out && typeof out === "object" && typeof (out as { image?: unknown }).image === "string") {
        const b64 = (out as { image: string }).image;
        if (b64.length > 1000) return { dataB64: b64, mime: "image/jpeg", width: 1024, height: 1024 };
      }
      const bytes = await streamBytes(out);
      if (bytes && bytes.length > 1000) {
        const png = bytes[0] === 0x89 && bytes[1] === 0x50;
        return { dataB64: toB64(bytes), mime: png ? "image/png" : "image/jpeg", width: 1024, height: 1024 };
      }
    } catch {
      /* next model */
    }
  }
  return null;
}

function mediaKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
async function attachPicture(orgId: string, contentId: string, idea: string): Promise<boolean> {
  const pic = await makePicture(idea);
  if (!pic) return false;
  const size = Math.floor((pic.dataB64.length * 3) / 4);
  await prisma.contentMedia.deleteMany({ where: { contentId } });
  await prisma.contentMedia.create({
    data: {
      organizationId: orgId, contentId, key: mediaKey(), position: 0, mime: pic.mime,
      name: pic.mime === "image/png" ? "autopilot.png" : "autopilot.jpg", width: pic.width, height: pic.height, sizeBytes: size, dataB64: pic.dataB64,
    },
    select: MEDIA_SELECT,
  });
  return true;
}

// ── The steps ────────────────────────────────────────────────────────────────

function finalTexts(d: Draft, xLimit: number): { text: string; textX: string } {
  const text = Array.from(d.linkedin).slice(0, LINKEDIN_MAX).join("");
  let x = d.x || d.linkedin;
  if (xLength(x) > xLimit) x = fitTo(x, xLimit);
  return { text, textX: x };
}

/** The networks this company can actually post on (an account set in Publishing → Accounts). */
async function networksFor(orgId: string, clientId: string): Promise<string> {
  const dests = destinationsOf(await getTarget(orgId, clientId));
  const nets = Array.from(new Set(dests.map((d) => d.network)));
  return nets.length ? nets.join(",") : "LINKEDIN,TWITTER";
}

/** Days of the window already covered for a company (by ANY post, human or Autopilot). */
async function coveredDays(orgId: string, clientId: string, w: PlanWindow): Promise<Set<string>> {
  const rows = await prisma.contentItem.findMany({
    where: { organizationId: orgId, clientId, scheduledAt: { gte: w.from, lt: w.to }, status: { not: "FAILED" } },
    select: { scheduledAt: true },
  });
  return new Set(rows.map((r) => etYmd(r.scheduledAt!)));
}

/** Generate up to `budget` missing posts. Returns how many were written and how many are still missing. */
async function generate(orgId: string, s: AutopilotSettings, w: PlanWindow, budget: number) {
  const pub = await getSettings(orgId);
  const xLimit = xMax(pub);
  let written = 0, missing = 0, pictureFailures = 0;
  const errors: string[] = [];
  for (const c of await autopilotClients(orgId, s)) {
    const covered = await coveredDays(orgId, c.id, w);
    const todo = w.days.filter((d) => !covered.has(d));
    missing += todo.length;
    if (!todo.length || written >= budget) continue;
    const chunk = todo.slice(0, Math.min(3, budget - written));
    const platforms = await networksFor(orgId, c.id);
    const planned = await prisma.contentItem.findMany({
      where: { organizationId: orgId, clientId: c.id, createdBy: AUTOPILOT, createdAt: { gte: new Date(Date.now() - 75 * DAY) } },
      select: { title: true },
      orderBy: { createdAt: "asc" },
    });
    let drafts: Draft[] = [];
    try {
      drafts = await writePosts(orgId, c, chunk, planned.map((p) => p.title || "").filter(Boolean), xLimit);
    } catch (e) {
      errors.push(`${c.name}: ${e instanceof Error ? e.message.slice(0, 200) : "AI failed"}`);
      continue;
    }
    for (let i = 0; i < drafts.length && i < chunk.length; i++) {
      const d = drafts[i];
      const { text, textX } = finalTexts(d, xLimit);
      const item = await prisma.contentItem.create({
        data: {
          organizationId: orgId, clientId: c.id, title: d.title || `${c.name} — ${chunk[i]}`, text, textX,
          platforms, status: "DRAFT", scheduledAt: etInstant(chunk[i], s.postTime), createdBy: AUTOPILOT,
        },
      });
      await addEvent(orgId, item.id, 1, "comment", "team", AUTOPILOT, `Written by Autopilot for ${chunk[i]}. Picture idea: ${d.image}`);
      if (!(await attachPicture(orgId, item.id, d.image || d.title || c.name))) pictureFailures++;
      written++;
      missing--;
    }
    if (!drafts.length) errors.push(`${c.name}: the AI answer could not be read`);
  }
  return { written, missing, pictureFailures, errors };
}

/** Posts without a picture (the image model failed earlier) get one now. */
async function fixPictures(orgId: string, budget: number): Promise<number> {
  const items = await prisma.contentItem.findMany({
    where: { organizationId: orgId, createdBy: AUTOPILOT, status: { in: ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED"] }, media: { none: {} } },
    select: { id: true, title: true, comments: { where: { authorName: AUTOPILOT, kind: "comment" }, select: { body: true }, take: 1 } },
    take: budget,
  });
  let n = 0;
  for (const it of items) {
    const idea = (it.comments[0]?.body || "").split("Picture idea: ")[1] || it.title || "business meeting";
    if (await attachPicture(orgId, it.id, idea)) n++;
  }
  return n;
}

/** All of the window written → send everything for review, ONE email. Once per month. */
async function submitMonth(orgId: string, s: AutopilotSettings, w: PlanWindow): Promise<{ submitted: number; emailed: boolean }> {
  const drafts = await prisma.contentItem.findMany({
    where: { organizationId: orgId, createdBy: AUTOPILOT, status: "DRAFT", scheduledAt: { gte: w.from, lt: w.to } },
    select: { id: true, clientId: true },
    orderBy: { scheduledAt: "asc" },
  });
  if (!drafts.length) return { submitted: 0, emailed: false };
  const clients = await autopilotClients(orgId, s);
  const byClient = new Map<string, number>();
  const skipped: string[] = [];
  for (const d of drafts) {
    const c = clients.find((x) => x.id === d.clientId);
    if (!c) continue;
    const err = await submitForReview(orgId, d.id, AUTOPILOT, { notify: false, batch: `${c.name} — ${w.label} (Autopilot)` });
    if (err) skipped.push(`${c.name}: ${err}`);
    else byClient.set(c.id, (byClient.get(c.id) || 0) + 1);
  }
  const submitted = [...byClient.values()].reduce((a, b) => a + b, 0);
  if (!submitted) return { submitted, emailed: false };
  // One email per company to whoever validates it (its reviewer, else the team).
  const deadline = new Date(Date.now() + s.autoApproveHours * 3600000);
  const deadlineTxt = deadline.toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  let emailed = false;
  for (const [clientId, n] of byClient) {
    const c = clients.find((x) => x.id === clientId)!;
    const link = reviewUrl(await reviewToken(orgId, clientId));
    const v = await validatorOf(orgId, clientId);
    const hi = v.name ? `Hi ${esc(v.name.split(/\s+/)[0])},` : "Hello,";
    const list = (await prisma.contentItem.findMany({
      where: { organizationId: orgId, clientId, createdBy: AUTOPILOT, status: "IN_REVIEW", scheduledAt: { gte: w.from, lt: w.to } },
      select: { title: true, text: true, scheduledAt: true },
      orderBy: { scheduledAt: "asc" },
    }))
      .slice(0, 31)
      .map((i) => `<li style="margin:3px 0"><span style="color:#666">${esc(i.scheduledAt ? i.scheduledAt.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }) : "")}</span> — ${esc((i.title || i.text).split("\n")[0].slice(0, 110))}</li>`)
      .join("");
    const ok = await sendMail(
      v.email,
      `${c.name} — ${w.label}: ${n} posts to validate`,
      `<p>${hi}</p>
       <p>The <b>${esc(w.label)}</b> content of <b>${esc(c.name)}</b> is ready for your validation — ${n} posts, one per day (text, X version and picture):</p>
       <ul>${list}</ul>
       <p>Read the month, comment, ask for changes or press <b>Approve all</b>. ${c.clientType === "CAMPAIGN" ? "Nothing is published before you approve it." : `Anything not answered is <b>approved automatically on ${esc(deadlineTxt)}</b> (New York).`}
       When it is validated, social@gershonconsulting.com is told it is ready for publishing.</p>
       ${skipped.length ? `<p style="color:#b45309;font-size:13px">Not sent: ${esc(skipped.slice(0, 5).join(" · "))}</p>` : ""}`,
      { href: link, label: "Validate the content" },
    );
    emailed = emailed || ok;
  }
  return { submitted, emailed };
}

/** Unanswered Autopilot posts are approved after `autoApproveHours`. */
async function autoApprove(orgId: string, s: AutopilotSettings): Promise<number> {
  const cutoff = new Date(Date.now() - s.autoApproveHours * 3600000);
  const internalIds = (await prisma.client.findMany({ where: { organizationId: orgId, clientType: "INTERNAL" }, select: { id: true } })).map((c) => c.id);
  const due = await prisma.contentItem.findMany({
    // Only Gershon's own (INTERNAL) companies auto-approve; a CAMPAIGN client always approves itself.
    where: { organizationId: orgId, createdBy: AUTOPILOT, status: "IN_REVIEW", submittedAt: { lt: cutoff }, clientId: { in: internalIds } },
    select: { id: true, version: true },
  });
  const now = new Date();
  for (const d of due) {
    await prisma.contentItem.update({ where: { id: d.id }, data: { status: "APPROVED", approvedAt: now, approvedBy: AUTOPILOT, approvedRole: "team" } });
    await addEvent(orgId, d.id, d.version, "approved", "team", AUTOPILOT, `Approved automatically — no answer within ${s.autoApproveHours} hours.`);
  }
  if (due.length) await notifyReadyForPublishing(orgId, due.map((d) => d.id), AUTOPILOT, `approved automatically after ${s.autoApproveHours}h without an answer`);
  return due.length;
}

/** "Ask for changes" → AI rewrites from the comment and sends it back for review. */
async function revise(orgId: string, s: AutopilotSettings, budget: number): Promise<number> {
  const items = await prisma.contentItem.findMany({
    where: { organizationId: orgId, createdBy: AUTOPILOT, status: "CHANGES_REQUESTED" },
    include: { comments: { where: { kind: "changes_requested" }, orderBy: { createdAt: "desc" }, take: 1 } },
    take: budget,
  });
  if (!items.length) return 0;
  const xLimit = xMax(await getSettings(orgId));
  const ai = { ...(await getAISettings()), model: TEXT_MODEL_HINT };
  let n = 0;
  for (const it of items) {
    const ask = it.comments[0]?.body || "Improve it.";
    const client = it.clientId ? await prisma.client.findFirst({ where: { id: it.clientId }, select: { name: true, industry: true } }) : null;
    const about = client ? aboutOf(client.name, client.industry) : null;
    try {
      const out = await runChat(
        ai,
        `You revise a LinkedIn post of ${client?.name || "the company"}${about ? ` (${about})` : ""} following the reviewer's request exactly. US English. Keep 500-1,300 characters, never invent numbers, names or results. Also give the X version (max ${Math.min(xLimit, 270)} characters). Answer ONLY with JSON: {"linkedin": string, "x": string, "image": string|null} — "image" only when the reviewer asks for a different picture: a photo description with no text in it.`,
        `REVIEWER'S REQUEST:\n${ask}\n\nCURRENT POST:\n${it.text}`,
        2000,
      );
      const a = out.text.indexOf("{"), b = out.text.lastIndexOf("}");
      const j = JSON.parse(out.text.slice(a, b + 1)) as { linkedin?: string; x?: string; image?: string | null };
      if (!j.linkedin || j.linkedin.trim().length < 80) continue;
      const { text, textX } = finalTexts({ title: it.title || "", linkedin: j.linkedin, x: clean(j.x || ""), image: "" }, xLimit);
      await prisma.contentItem.update({ where: { id: it.id }, data: { text, textX, version: it.version + 1, status: "DRAFT" } });
      await addEvent(orgId, it.id, it.version + 1, "edited", "team", AUTOPILOT, `Rewritten by Autopilot from your comment: “${ask.slice(0, 300)}”`);
      if (j.image && /picture|image|photo|visual/i.test(ask)) await attachPicture(orgId, it.id, j.image);
      const err = await submitForReview(orgId, it.id, AUTOPILOT, { notify: false, batch: null });
      if (!err) n++;
    } catch {
      /* try again next run */
    }
  }
  if (n) {
    await alertTeam(orgId, `Autopilot rewrote ${n} post${n === 1 ? "" : "s"} from your comments`, `<p>${n} post${n === 1 ? " is" : "s are"} back for your review. Unanswered, ${n === 1 ? "it is" : "they are"} approved automatically in ${s.autoApproveHours} hours.</p>`, `${SITE}/publishing`);
  }
  return n;
}

/** Approved Autopilot posts go on the calendar on their own day. */
async function scheduleApproved(orgId: string, s: AutopilotSettings): Promise<{ scheduled: number; problems: string[] }> {
  const items = await prisma.contentItem.findMany({
    where: { organizationId: orgId, createdBy: AUTOPILOT, status: "APPROVED", approvedAt: { not: null } },
    select: { id: true, clientId: true, scheduledAt: true, title: true },
    orderBy: { scheduledAt: "asc" },
  });
  let scheduled = 0;
  const problems: string[] = [];
  const now = Date.now();
  for (const it of items) {
    let when = it.scheduledAt;
    if (!when || when.getTime() < now + 10 * 60000) {
      // Its day has passed (or it lost its date in an edit): the next free day.
      const taken = new Set(
        (await prisma.contentItem.findMany({
          // Every planned or scheduled post of this company counts — one post per day, never two.
          where: { organizationId: orgId, clientId: it.clientId, id: { not: it.id }, status: { not: "FAILED" }, scheduledAt: { gte: new Date(now - DAY) } },
          select: { scheduledAt: true },
        })).map((r) => etYmd(r.scheduledAt!)),
      );
      let day = etYmd(new Date(now));
      for (let i = 0; i < 60; i++) {
        const t = etInstant(day, s.postTime);
        if (t.getTime() > now + 10 * 60000 && !taken.has(day)) { when = t; break; }
        day = addDays(day, 1);
      }
    }
    if (!when) continue;
    // Post only where the company has an account (e.g. X only while it has no LinkedIn page).
    if (it.clientId) {
      const nets = await networksFor(orgId, it.clientId);
      await prisma.contentItem.update({ where: { id: it.id }, data: { platforms: nets } });
    }
    const p = await scheduleItem(orgId, it.id, when);
    if (p.length) problems.push(...p);
    else scheduled++;
  }
  return { scheduled, problems: Array.from(new Set(problems)) };
}

/** Set every Autopilot company's posting objective to 7 a week (one a day), unless it was set by hand. */
async function alignObjectives(orgId: string, clientIds: string[]): Promise<void> {
  const { o } = await objectivesFor(orgId, []);
  let changed = false;
  for (const id of clientIds) if (o.companies[id] === undefined) { o.companies[id] = 7; changed = true; }
  if (changed) await saveObjectives(orgId, o);
}

export type StepResult = {
  enabled: boolean;
  window: { label: string; days: number };
  written: number;
  remaining: number;
  picturesFixed: number;
  revised: number;
  autoApproved: number;
  scheduled: number;
  submitted: number;
  emailed: boolean;
  problems: string[];
  errors: string[];
};

/** One bounded unit of Autopilot work for a workspace. Safe to call again and again. */
/**
 * v4.63.0: one Autopilot step at a time per workspace. Two steps running at
 * once (the daily cron and the page, or two tabs) each saw the same empty days
 * and both wrote a post for them — Meteor Biotech got 8 duplicates on
 * 2026-10-22. A step now takes a 3-minute lock; a second one waits its turn.
 */
const RUN_LOCK = "autopilot_run_lock";
async function takeRunLock(orgId: string): Promise<boolean> {
  const now = Date.now();
  try {
    await prisma.orgSetting.create({ data: { organizationId: orgId, key: RUN_LOCK, value: String(now) } });
    return true;
  } catch {}
  const r = await prisma.orgSetting.updateMany({
    where: { organizationId: orgId, key: RUN_LOCK, value: { lt: String(now - 180000) } },
    data: { value: String(now) },
  });
  return r.count === 1;
}
async function releaseRunLock(orgId: string): Promise<void> {
  await prisma.orgSetting.deleteMany({ where: { organizationId: orgId, key: RUN_LOCK } }).catch(() => null);
}

export async function runStep(orgId: string, budget = 3, now = new Date()): Promise<StepResult> {
  if (!(await takeRunLock(orgId))) {
    const s0 = await getAutopilotSettings(orgId);
    const w0 = planWindow(s0, now);
    return { enabled: true, window: { label: w0.label, days: w0.days.length }, written: 0, remaining: 1, picturesFixed: 0, revised: 0, autoApproved: 0, scheduled: 0, submitted: 0, emailed: false, problems: [], errors: ["Another Autopilot step is running — trying again."] };
  }
  try {
    return await runStepLocked(orgId, budget, now);
  } finally {
    await releaseRunLock(orgId);
  }
}

async function runStepLocked(orgId: string, budget: number, now: Date): Promise<StepResult> {
  const s = await getAutopilotSettings(orgId);
  const w = planWindow(s, now);
  const base: StepResult = { enabled: false, window: { label: w.label, days: w.days.length }, written: 0, remaining: 0, picturesFixed: 0, revised: 0, autoApproved: 0, scheduled: 0, submitted: 0, emailed: false, problems: [], errors: [] };
  if (!(await isEnabled(orgId, s))) return base;
  base.enabled = true;
  const clients = await autopilotClients(orgId, s);
  await alignObjectives(orgId, clients.map((c) => c.id));

  base.autoApproved = await autoApprove(orgId, s);
  const sch = await scheduleApproved(orgId, s);
  base.scheduled = sch.scheduled;
  base.problems = sch.problems;
  base.revised = await revise(orgId, s, 1);

  const g = await generate(orgId, s, w, budget);
  base.written = g.written;
  base.remaining = g.missing;
  base.errors = g.errors;
  if (!g.written) base.picturesFixed = await fixPictures(orgId, 2);
  const noPicture = await prisma.contentItem.count({ where: { organizationId: orgId, createdBy: AUTOPILOT, status: "DRAFT", media: { none: {} }, scheduledAt: { gte: w.from, lt: w.to } } });
  base.remaining += noPicture > 0 && !g.written && !base.picturesFixed ? 0 : noPicture;

  // Month complete and every post has its picture → one review email.
  if (g.missing === 0 && noPicture === 0) {
    const r = await submitMonth(orgId, s, w);
    base.submitted = r.submitted;
    base.emailed = r.emailed;
  }

  // Problems that block publishing (no X account…) → once a day to the team.
  if (base.problems.length) {
    const key = "autopilot_problem_day";
    const today = etYmd(now);
    if ((await readSetting(orgId, key)) !== today) {
      if (await alertTeam(orgId, "Autopilot could not schedule some approved posts", `<p>${base.problems.map(esc).join("<br>")}</p>`, `${SITE}/publishing/accounts`)) {
        await writeSetting(orgId, key, today);
      }
    }
  }
  return base;
}

/** What the Publishing page shows. */
export async function status(orgId: string, now = new Date()) {
  const s = await getAutopilotSettings(orgId);
  const w = planWindow(s, now);
  const enabled = await isEnabled(orgId, s);
  const clients = await autopilotClients(orgId, s);
  const all = await prisma.client.findMany({
    where: { organizationId: orgId, clientType: { in: AUTOPILOT_TYPES }, archivedAt: null, status: { not: "ARCHIVED" } },
    select: { id: true, name: true, clientType: true },
    orderBy: { name: "asc" },
  });
  const items = await prisma.contentItem.findMany({
    where: { organizationId: orgId, createdBy: AUTOPILOT, scheduledAt: { gte: w.from, lt: w.to } },
    select: { clientId: true, status: true },
  });
  const perClient = await Promise.all(
    clients.map(async (c) => {
      const mine = items.filter((i) => i.clientId === c.id);
      const t = await getTarget(orgId, c.id);
      return {
        clientId: c.id,
        name: c.name,
        clientType: c.clientType,
        planned: (await coveredDays(orgId, c.id, w)).size,
        days: w.days.length,
        inReview: mine.filter((i) => i.status === "IN_REVIEW").length,
        approved: mine.filter((i) => ["APPROVED", "SCHEDULED", "PUBLISHED", "PARTIAL"].includes(i.status)).length,
        changes: mine.filter((i) => i.status === "CHANGES_REQUESTED").length,
        accountsOk: destinationsOf(t).some((d) => d.network === "LINKEDIN") && destinationsOf(t).some((d) => d.network === "TWITTER"),
        networks: Array.from(new Set(destinationsOf(t).map((d) => (d.network === "LINKEDIN" ? "LinkedIn" : "X")))),
        reviewUrl: reviewUrl(await reviewToken(orgId, c.id)),
      };
    }),
  );
  return { settings: s, enabled, window: { label: w.label, first: w.days[0] || null, last: w.days[w.days.length - 1] || null }, clients: perClient, internal: all };
}
