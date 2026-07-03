export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";

const KEY_NAME = "streak";

const schema = z.object({
  apiKey: z.string().min(10).max(200).optional(),
  pipelineKey: z.string().optional().nullable(),
  currentStageKeys: z.string().optional().nullable(), // comma-separated
});

type Stored = {
  apiKey?: string;
  pipelineKey?: string | null;
  currentStageKeys?: string[];
};

export async function GET() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY_NAME } });
    if (!row) {
      return NextResponse.json({ success: true, data: { configured: false } });
    }
    const parsed = JSON.parse(row.value) as Stored;
    const masked = parsed.apiKey
      ? `${parsed.apiKey.slice(0, 4)}…${parsed.apiKey.slice(-4)}`
      : null;
    return NextResponse.json({
      success: true,
      data: {
        configured: !!parsed.apiKey,
        apiKeyMasked: masked,
        pipelineKey: parsed.pipelineKey ?? null,
        currentStageKeys: (parsed.currentStageKeys ?? []).join(","),
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
        { success: false, error: "Invalid input." },
        { status: 400 },
      );
    }

    // Merge with existing so pipeline/stage edits don't wipe a saved key,
    // and pasting a new key doesn't require re-entering pipeline/stages.
    const existingRow = await prisma.setting.findUnique({ where: { key: KEY_NAME } });
    const existing: Stored = existingRow ? (JSON.parse(existingRow.value) as Stored) : {};

    const apiKey = parsed.data.apiKey?.trim() || existing.apiKey;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Paste your Streak API key to save." },
        { status: 400 },
      );
    }

    const stageStr =
      parsed.data.currentStageKeys !== undefined && parsed.data.currentStageKeys !== null
        ? parsed.data.currentStageKeys
        : (existing.currentStageKeys ?? []).join(",");
    const currentStageKeys = stageStr.split(",").map((s) => s.trim()).filter(Boolean);

    const pipelineKey =
      parsed.data.pipelineKey !== undefined
        ? (parsed.data.pipelineKey?.trim() || null)
        : (existing.pipelineKey ?? null);

    const value = JSON.stringify({ apiKey, pipelineKey, currentStageKeys } satisfies Stored);

    await prisma.setting.upsert({
      where: { key: KEY_NAME },
      update: { value },
      create: { key: KEY_NAME, value },
    });

    return NextResponse.json({ success: true, message: "Streak settings saved." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
