export const runtime = 'edge';
/**
 * GET /api/clients/activity — per company: last post date and post counts.
 * Two grouped queries, no post rows loaded. Feeds the verdict column on the
 * Companies page (v4.14.0). Scoped to the caller's workspace by db.ts.
 */
import { NextResponse } from "next/server";
import prisma from "@/lib/db";

export async function GET() {
  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const monthStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    const [last, month, last30] = await Promise.all([
      prisma.socialPost.groupBy({ by: ["clientId"], _max: { publishedDateLocal: true } }),
      prisma.socialPost.groupBy({ by: ["clientId"], where: { publishedDateLocal: { gte: monthStart } }, _count: { _all: true } }),
      prisma.socialPost.groupBy({ by: ["clientId"], where: { publishedDateLocal: { gte: d30 } }, _count: { _all: true } }),
    ]);

    const out: Record<string, { lastPostDateLocal: string | null; postsThisMonth: number; posts30: number }> = {};
    const row = (id: string) => (out[id] ??= { lastPostDateLocal: null, postsThisMonth: 0, posts30: 0 });
    for (const r of last) row(r.clientId).lastPostDateLocal = r._max.publishedDateLocal ?? null;
    for (const r of month) row(r.clientId).postsThisMonth = r._count._all;
    for (const r of last30) row(r.clientId).posts30 = r._count._all;

    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
