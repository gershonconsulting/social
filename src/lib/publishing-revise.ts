/**
 * New version from a comment (v4.55.0).
 *
 * RULE (Olivier, 2026-10-21): when someone comments on a post, the system uses
 * the comment to write a NEW VERSION of the post. Applies to every post in
 * Publishing (CAMPAIGN and INTERNAL, Autopilot or hand-written), to the
 * client's comments and change requests on the review page, and to the team's
 * comments in the post panel.
 *
 * - Intelligence (Cloudflare Workers AI) reads the comment, the current post,
 *   the company's Knowledge Base and the thread, and rewrites the LinkedIn text
 *   and the X version. A comment that asks for nothing ("Looks great!") gets
 *   no new version.
 * - The version number goes up; the old text is kept in the thread
 *   ("previous_version" event) so the team can bring it back.
 * - A post that was with the client goes straight back to them as the new
 *   version (IN_REVIEW). A draft stays a draft. Approved / scheduled /
 *   published posts are never rewritten from a comment.
 * - A comment that asks for another picture also gets a new picture.
 */
import prisma from "@/lib/db-raw";
import { getAISettings, runChat } from "@/lib/content/provider";
import { addEvent, getSettings, LINKEDIN_MAX, MEDIA_SELECT, xLength, xMax } from "@/lib/publishing";
import { aboutOf } from "@/lib/reports/ops/intelligence";
import { clean, fitTo } from "@/lib/x-fit";
import { getKB, kbForPrompt } from "@/lib/knowledge-base";

export const INTELLIGENCE = "Intelligence";
const TEXT_MODEL_HINT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const OPEN = ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED"];

export type ReviseResult =
  | { revised: true; version: number; text: string; textX: string; picture: boolean; status: string }
  | { revised: false; reason: string };

function parse(text: string): { change?: boolean; linkedin?: string; x?: string; image?: string | null; note?: string } | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Replace the post's picture with one made by Workers AI (same as Autopilot). */
async function newPicture(orgId: string, contentId: string, idea: string): Promise<boolean> {
  const { makePicture } = await import("@/lib/autopilot");
  const pic = await makePicture(idea);
  if (!pic) return false;
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const key = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  await prisma.contentMedia.deleteMany({ where: { contentId } });
  await prisma.contentMedia.create({
    data: {
      organizationId: orgId, contentId, key, position: 0, mime: pic.mime,
      name: pic.mime === "image/png" ? "revised.png" : "revised.jpg", width: pic.width, height: pic.height,
      sizeBytes: Math.floor((pic.dataB64.length * 3) / 4), dataB64: pic.dataB64,
    },
    select: MEDIA_SELECT,
  });
  return true;
}

const PICTURE_ASK = /\b(picture|image|photo|visual|illustration|graphic)s?\b/i;

/**
 * Write a new version of a post from a comment. Never throws: on any failure
 * the comment simply stays in the thread, as before.
 */
export async function reviseFromComment(
  orgId: string,
  itemId: string,
  comment: string,
  by: { role: "team" | "client"; name: string | null },
): Promise<ReviseResult> {
  const ask = comment.trim();
  if (ask.length < 3) return { revised: false, reason: "empty" };
  const item = await prisma.contentItem.findFirst({ where: { id: itemId, organizationId: orgId } });
  if (!item) return { revised: false, reason: "not found" };
  if (!OPEN.includes(item.status)) return { revised: false, reason: "already approved" };

  try {
    const client = item.clientId
      ? await prisma.client.findFirst({ where: { id: item.clientId }, select: { name: true, industry: true, website: true } })
      : null;
    const about = client ? aboutOf(client.name, client.industry) : null;
    const kb = item.clientId ? await getKB(orgId, item.clientId).catch(() => null) : null;
    const xLimit = Math.min(xMax(await getSettings(orgId)), 280);
    const history = await prisma.contentComment.findMany({
      where: { contentId: item.id, kind: { in: ["comment", "changes_requested"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { authorRole: true, body: true },
    });
    const earlier = history
      .slice(1)
      .reverse()
      .filter((h) => h.body && h.body.trim() !== ask)
      .map((h) => `- (${h.authorRole}) ${h.body!.replace(/\s+/g, " ").slice(0, 300)}`);
    const company = client?.name || "the company";
    const nets = item.platforms.split(",");

    const system = `You are the senior social-media copywriter of ${company}${client?.website ? ` (${client.website})` : ""}${about ? ` — ${about}` : ""}.
A ${by.role === "client" ? "client reviewer" : "team member"} left a comment on a post. Write the NEW VERSION of the post that does exactly what the comment asks.
Rules:
- Apply every instruction of the comment. Keep everything the comment does not ask to change (topic, voice, structure, hashtags) unless it must change to follow the comment.
- US English. LinkedIn post: 300-1,300 characters unless the comment asks for another length; short paragraphs; at most 2 emoji.
- NEVER invent statistics, numbers, client names, quotes, awards, prices or results. If the comment gives facts, use them as given.
- X version: at most ${xLimit - 10} characters including hashtags; same idea, tighter.
- If the comment asks for NO change to the text (praise, thanks, a question, a scheduling note), set "change" to false.
- "image": only when the comment asks for a different picture — a description of a photograph with NO text, letters, numbers, logos or screens with writing. Otherwise null.
Answer ONLY with JSON: {"change": boolean, "linkedin": string, "x": string, "image": string|null, "note": string (one short sentence: what you changed)}`;

    const user = [
      `COMMENT:\n${ask}`,
      earlier.length ? `EARLIER COMMENTS ON THIS POST (already handled unless repeated):\n${earlier.join("\n")}` : "",
      `CURRENT LINKEDIN POST (version ${item.version}):\n${item.text}`,
      nets.includes("TWITTER") ? `CURRENT X VERSION:\n${item.textX?.trim() || "(same as LinkedIn)"}` : "",
      kb ? kbForPrompt(kb) : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const ai = { ...(await getAISettings()), model: TEXT_MODEL_HINT };
    let j: ReturnType<typeof parse> = null;
    for (let attempt = 0; attempt < 2 && !j; attempt++) {
      const out = await runChat(ai, system, user, 2000);
      j = parse(out.text);
    }
    if (!j) return { revised: false, reason: "the AI answer could not be read" };
    const wantsPicture = PICTURE_ASK.test(ask) && !!j.image && String(j.image).trim().length > 10;
    const linkedin = (j.linkedin || "").replace(/\r\n/g, "\n").trim();
    const textChanged = j.change !== false && linkedin.length >= 80 && linkedin !== item.text.trim();
    if (!textChanged && !wantsPicture) return { revised: false, reason: "the comment asks for no change" };

    const text = textChanged ? Array.from(linkedin).slice(0, LINKEDIN_MAX).join("") : item.text;
    let textX = item.textX || "";
    if (textChanged) {
      let x = clean(j.x || "") || text;
      if (xLength(x) > xLimit) x = fitTo(x, xLimit);
      textX = x;
    }

    let picture = false;
    if (wantsPicture) {
      try {
        picture = await newPicture(orgId, item.id, String(j.image).slice(0, 500));
      } catch {
        picture = false;
      }
      if (!picture && !textChanged) return { revised: false, reason: "the new picture could not be made" };
    }

    // Keep the old version in the thread (team-only) so it can be brought back.
    await addEvent(orgId, item.id, item.version, "previous_version", "team", INTELLIGENCE, JSON.stringify({ text: item.text, textX: item.textX || "" }));

    const version = item.version + 1;
    // With the client → the new version goes straight back to them. Draft stays draft.
    const status = item.status === "DRAFT" ? "DRAFT" : "IN_REVIEW";
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { text, textX: textX || null, version, status, ...(status === "IN_REVIEW" ? { submittedAt: new Date() } : {}) },
    });
    const note = (j.note || "").replace(/\s+/g, " ").trim().slice(0, 300);
    await addEvent(
      orgId,
      item.id,
      version,
      "revised",
      "team",
      INTELLIGENCE,
      `New version ${version} written from ${by.name ? by.name + "’s" : "the"} comment${note ? ` — ${note}` : "."}${picture ? " New picture." : ""}`,
    );
    return { revised: true, version, text, textX, picture, status };
  } catch {
    return { revised: false, reason: "Intelligence is unavailable right now" };
  }
}
