export const runtime = "edge";
/**
 * POST /api/publishing/review-batch — send several posts of ONE company for
 * review together, CloudCampaign-style (v4.41.0). One email to the reviewer.
 *
 * Body: { clientId: string, ids?: string[], name?: string }
 *   ids omitted → every draft / changes-requested post of that company.
 * Answer: { sent: string[], skipped: [{ id, title, reason }], batch, emailed }
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { PUBLISHING_CLIENT_WHERE } from "@/lib/publishing";
import { submitBatch } from "@/lib/publishing-review";

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  try {
    const b = (await req.json().catch(() => null)) as { clientId?: string; ids?: unknown; name?: string } | null;
    if (!b?.clientId) return NextResponse.json({ success: false, error: "Pick the company first." }, { status: 400 });
    const cl = await prisma.client.findFirst({ where: { id: b.clientId, organizationId: c.orgId, ...PUBLISHING_CLIENT_WHERE }, select: { id: true } });
    if (!cl) return NextResponse.json({ success: false, error: "Publishing is only for campaign and internal companies." }, { status: 400 });
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 200) : null;
    const out = await submitBatch(c.orgId, cl.id, ids, c.name, b.name ?? null);
    if (!out.sent.length) {
      return NextResponse.json(
        { success: false, error: out.skipped.length ? "None of the posts is ready: " + out.skipped.map((s) => `${s.title} — ${s.reason}`).join(" · ") : "No draft to send for this company.", data: out },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, data: out });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
