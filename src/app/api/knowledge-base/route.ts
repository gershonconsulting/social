export const runtime = "edge";
/**
 * GET /api/knowledge-base (v4.51.0) — the Publishing companies (CAMPAIGN +
 * INTERNAL) with what their Knowledge Base holds: value prop yes/no,
 * competitive notes yes/no, number of ICPs.
 */
import { NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { PUBLISHING_CLIENT_WHERE } from "@/lib/publishing";
import { getKB } from "@/lib/knowledge-base";

export async function GET() {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  try {
    const clients = await prisma.client.findMany({
      where: { organizationId: c.orgId, archivedAt: null, status: { not: "ARCHIVED" }, ...PUBLISHING_CLIENT_WHERE },
      select: { id: true, name: true, clientType: true },
      orderBy: [{ clientType: "desc" }, { name: "asc" }],
    });
    const rows = [];
    for (const cl of clients) {
      const kb = await getKB(c.orgId, cl.id);
      rows.push({
        ...cl,
        hasValueProp: !!kb.valueProp.text.trim(),
        hasCompetitive: !!kb.competitive.notes.trim(),
        icps: kb.icps.map((i) => ({ id: i.id, name: i.name })),
      });
    }
    return NextResponse.json({ success: true, data: { companies: rows, canWrite: c.canWrite } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
