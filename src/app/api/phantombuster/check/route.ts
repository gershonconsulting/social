export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getPbConfig } from "@/lib/phantombuster";

/**
 * GET /api/phantombuster/check?phantomId=X
 * Single fast call: ask Phantombuster what the agent's lastEndStatus is and
 * (when finished) where the result CSV lives. No waiting/polling on the
 * server — that's the browser's job.
 */
export async function GET(req: NextRequest) {
  try {
    const phantomId = req.nextUrl.searchParams.get("phantomId");
    if (!phantomId) {
      return NextResponse.json({ success: false, error: "phantomId is required" }, { status: 400 });
    }
    const config = await getPbConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: "Phantombuster is not configured." }, { status: 400 });
    }

    const r = await fetch(`https://api.phantombuster.com/api/v2/agents/fetch?id=${encodeURIComponent(phantomId)}`, {
      headers: { "x-phantombuster-key": config.apiKey },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return NextResponse.json({ success: false, error: `PB fetch returned ${r.status}: ${body.slice(0, 200)}` }, { status: 502 });
    }
    const j = (await r.json()) as { data?: { lastEndType?: string; orgS3Folder?: string; s3Folder?: string } };
    const data = j.data ?? {};
    const status = data.lastEndType ?? null;
    const resultUrl =
      data.orgS3Folder && data.s3Folder
        ? `https://phantombuster.s3.amazonaws.com/${data.orgS3Folder}/${data.s3Folder}/result.csv`
        : null;
    return NextResponse.json({ success: true, data: { phantomId, status, resultUrl } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Check failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
