export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";

const KEY_NAME = "phantombuster";

const schema = z.object({
  apiKey: z.string().min(20).max(200),
  twitterPhantomId: z.string().optional().nullable(),
  linkedinPhantomId: z.string().optional().nullable(),
  deleteAfterRun: z.boolean().optional(),
});

export async function GET() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY_NAME } });
    if (!row) {
      return NextResponse.json({ success: true, data: { configured: false } });
    }
    const parsed = JSON.parse(row.value) as {
      apiKey?: string;
      twitterPhantomId?: string | null;
      linkedinPhantomId?: string | null;
      deleteAfterRun?: boolean;
    };
    // Mask the API key — don't echo it back fully
    const masked = parsed.apiKey
      ? `${parsed.apiKey.slice(0, 4)}…${parsed.apiKey.slice(-4)}`
      : null;
    return NextResponse.json({
      success: true,
      data: {
        configured: !!parsed.apiKey,
        apiKeyMasked: masked,
        twitterPhantomId: parsed.twitterPhantomId ?? null,
        linkedinPhantomId: parsed.linkedinPhantomId ?? null,
        deleteAfterRun: !!parsed.deleteAfterRun,
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read settings";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid input. apiKey is required (20+ chars)." },
        { status: 400 }
      );
    }

    const value = JSON.stringify({
      apiKey: parsed.data.apiKey,
      twitterPhantomId: parsed.data.twitterPhantomId ?? null,
      linkedinPhantomId: parsed.data.linkedinPhantomId ?? null,
      deleteAfterRun: parsed.data.deleteAfterRun ?? false,
    });

    await prisma.setting.upsert({
      where: { key: KEY_NAME },
      update: { value },
      create: { key: KEY_NAME, value },
    });

    return NextResponse.json({ success: true, message: "Phantombuster settings saved." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
