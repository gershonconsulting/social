export const runtime = "edge";
/**
 * /api/knowledge-base/<clientId> (v4.51.0)
 *   GET  → { kb, snapshot } — the saved Knowledge Base + the live competitive
 *          snapshot from collected competitor posts.
 *   PUT  → save { valueProp?, competitive?, icps? } (edits become "manual").
 *   POST { section: "valueProp"|"competitive"|"icps"|"all", overwrite?: boolean }
 *        → draft with Intelligence.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { competitiveSnapshot, draftKB, getKB, saveKB, type KnowledgeBase, type Section } from "@/lib/knowledge-base";

type Ctx = { params: Promise<{ clientId: string }> };

async function own(orgId: string, clientId: string) {
  return prisma.client.findFirst({ where: { id: clientId, organizationId: orgId }, select: { id: true, name: true, clientType: true } });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  const { clientId } = await ctx.params;
  const client = await own(c.orgId, clientId);
  if (!client) return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  try {
    const [kb, snapshot] = [await getKB(c.orgId, clientId), await competitiveSnapshot(c.orgId, clientId).catch(() => null)];
    return NextResponse.json({ success: true, data: { client, kb, snapshot } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const { clientId } = await ctx.params;
  if (!(await own(c.orgId, clientId))) return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  try {
    const b = ((await req.json().catch(() => null)) || {}) as Partial<KnowledgeBase>;
    const kb = await getKB(c.orgId, clientId);
    const now = new Date().toISOString();
    if (b.valueProp && typeof b.valueProp.text === "string" && b.valueProp.text !== kb.valueProp.text) kb.valueProp = { text: b.valueProp.text, source: "manual", updatedAt: now };
    if (b.competitive && typeof b.competitive.notes === "string" && b.competitive.notes !== kb.competitive.notes) kb.competitive = { notes: b.competitive.notes, source: "manual", updatedAt: now };
    if (Array.isArray(b.icps)) {
      kb.icps = b.icps.map((i) => {
        const prev = kb.icps.find((p) => p.id === i.id);
        const same = prev && prev.name === i.name && prev.description === i.description;
        return same ? prev! : { id: i.id || "", name: i.name, description: i.description, source: "manual" as const, updatedAt: now };
      });
    }
    return NextResponse.json({ success: true, data: { kb: await saveKB(c.orgId, clientId, kb) } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const { clientId } = await ctx.params;
  if (!(await own(c.orgId, clientId))) return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  try {
    const b = ((await req.json().catch(() => null)) || {}) as { section?: Section; overwrite?: boolean };
    const section: Section = ["valueProp", "competitive", "icps", "all"].includes(b.section as string) ? (b.section as Section) : "all";
    const kb = await draftKB(c.orgId, clientId, section, b.overwrite !== false);
    return NextResponse.json({ success: true, data: { kb } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
