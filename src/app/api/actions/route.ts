export const runtime = "edge";
/**
 * The workspace's action cards (v4.70.0) — what the /actions page reads and changes.
 *
 * GET                                  cards (newest first) + last week's results
 * POST { op: "status", id, status }    open / done / dismissed
 * POST { op: "draft", id }             write the post / comment / note with Intelligence
 * POST { op: "save-draft", id, text }  keep the user's edited draft
 * POST { op: "publish", id }           send a Promote draft to Publish as a DRAFT content item
 *                                      (campaign / internal companies only — Publish's scope)
 * POST { op: "refresh" }               run today's Intelligence now for this workspace
 *
 * Always the caller's own workspace (session). READ_ONLY users can look, not change.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import rawDb from "@/lib/db-raw";
import { requireAuth } from "@/lib/auth";
import { orgFromSession } from "@/lib/session-org";
import { readCards, updateCard } from "@/lib/actions/store";
import { buildResults } from "@/lib/actions/results";
import { draftFor } from "@/lib/actions/draft";
import { buildIntelligenceReport } from "@/lib/reports/ops/intelligence";

const PUBLISH_ORIGIN = "https://publish.gershon.ai";
const PUBLISH_TYPES = new Set(["CAMPAIGN", "INTERNAL"]);

function fail(e: unknown): NextResponse {
  const m = e instanceof Error ? e.message : "";
  if (m === "UNAUTHORIZED") return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "Your role can view actions but not change them" }, { status: 403 });
  if (m === "NO_ORGANIZATION") return NextResponse.json({ success: false, error: "Your account isn't attached to a workspace yet." }, { status: 409 });
  return NextResponse.json({ success: false, error: m || "Server error" }, { status: 500 });
}

async function context() {
  const user = await requireAuth();
  const orgId = await orgFromSession();
  if (!orgId) throw new Error("NO_ORGANIZATION");
  return { user, orgId };
}

export async function GET() {
  try {
    const { orgId, user } = await context();
    const [cards, results, watched, clients] = await Promise.all([
      readCards(orgId),
      buildResults(orgId),
      rawDb.client.count({ where: { organizationId: orgId, archivedAt: null, status: { not: "ARCHIVED" }, clientType: "COMPETITION" } }),
      rawDb.client.findMany({ where: { organizationId: orgId }, select: { id: true, clientType: true } }),
    ]);
    const typeOf = new Map(clients.map((c) => [c.id, c.clientType]));
    return NextResponse.json({
      success: true,
      data: {
        cards: cards.slice(0, 120).map((c) => ({ ...c, canPublish: !!c.forCompanyId && PUBLISH_TYPES.has(String(typeOf.get(c.forCompanyId))) && c.pillar === "PROMOTE" })),
        results,
        competitors: watched,
        canEdit: user.role !== "READ_ONLY",
        publishOrigin: PUBLISH_ORIGIN,
      },
    });
  } catch (e) {
    return fail(e);
  }
}

const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status"), id: z.string().min(1), status: z.enum(["open", "done", "dismissed"]) }),
  z.object({ op: z.literal("draft"), id: z.string().min(1) }),
  z.object({ op: z.literal("save-draft"), id: z.string().min(1), text: z.string().max(5000) }),
  z.object({ op: z.literal("publish"), id: z.string().min(1) }),
  z.object({ op: z.literal("refresh") }),
]);

export async function POST(req: NextRequest) {
  try {
    const { orgId, user } = await context();
    if (user.role === "READ_ONLY") throw new Error("FORBIDDEN");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Unknown request" }, { status: 400 });
    const b = parsed.data;

    if (b.op === "refresh") {
      const r = await buildIntelligenceReport(orgId, { refresh: true });
      return NextResponse.json({ success: true, data: { cards: r.cards.length, ai: r.source.ai, note: r.source.note } });
    }

    if (b.op === "status") {
      const c = await updateCard(orgId, b.id, { status: b.status });
      return c ? NextResponse.json({ success: true, data: c }) : NextResponse.json({ success: false, error: "Action not found" }, { status: 404 });
    }

    if (b.op === "save-draft") {
      const c = await updateCard(orgId, b.id, { draft: b.text.trim() || null });
      return c ? NextResponse.json({ success: true, data: c }) : NextResponse.json({ success: false, error: "Action not found" }, { status: 404 });
    }

    const card = (await readCards(orgId)).find((c) => c.id === b.id);
    if (!card) return NextResponse.json({ success: false, error: "Action not found" }, { status: 404 });

    if (b.op === "draft") {
      const company = card.forCompanyId
        ? await rawDb.client.findFirst({ where: { id: card.forCompanyId, organizationId: orgId }, select: { industry: true } })
        : null;
      const d = await draftFor(card, company?.industry ?? null);
      const c = await updateCard(orgId, card.id, { draft: d.text });
      return NextResponse.json({ success: true, data: { ...c, ai: d.ai } });
    }

    // publish → a DRAFT content item in Publish (same database), for the company's own validation flow there.
    if (!card.draft) return NextResponse.json({ success: false, error: "Write or generate the draft first" }, { status: 400 });
    if (card.pillar !== "PROMOTE") return NextResponse.json({ success: false, error: "Only posts can go to Publish" }, { status: 400 });
    if (card.publishItemId) return NextResponse.json({ success: true, data: { itemId: card.publishItemId, url: `${PUBLISH_ORIGIN}/?item=${card.publishItemId}`, already: true } });
    const company = card.forCompanyId
      ? await rawDb.client.findFirst({ where: { id: card.forCompanyId, organizationId: orgId }, select: { id: true, clientType: true } })
      : null;
    if (!company || !PUBLISH_TYPES.has(company.clientType)) {
      return NextResponse.json({ success: false, error: "Publish only handles campaign and internal companies — copy the draft instead" }, { status: 400 });
    }
    const item = await rawDb.contentItem.create({
      data: {
        organizationId: orgId,
        clientId: company.id,
        title: card.action.slice(0, 120),
        text: card.draft,
        status: "DRAFT",
        createdBy: `Social · Actions (${user.email || user.name || "user"})`,
      },
      select: { id: true },
    });
    await updateCard(orgId, card.id, { publishItemId: item.id });
    return NextResponse.json({ success: true, data: { itemId: item.id, url: `${PUBLISH_ORIGIN}/?item=${item.id}` } });
  } catch (e) {
    return fail(e);
  }
}
