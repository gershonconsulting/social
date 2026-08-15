export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { z } from "zod";
import { DEFAULT_MODEL, getAnthropicSettings, listModels } from "@/lib/content/analyze";

const KEY_NAME = "anthropic";

const schema = z.object({
  apiKey: z.string().min(20).max(300).optional(),
  model: z.string().min(3).max(120).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    // ?models=1 asks Anthropic which models this key can actually use, so the
    // UI never has to hard-code an id that may be retired later.
    if (req.nextUrl.searchParams.get("models") === "1") {
      const settings = await getAnthropicSettings();
      if (!settings.apiKey) {
        return NextResponse.json({ success: false, error: "No API key saved yet." }, { status: 428 });
      }
      const models = await listModels(settings.apiKey);
      return NextResponse.json({ success: true, data: { models } });
    }

    const row = await prisma.setting.findUnique({ where: { key: KEY_NAME } });
    const envKey = !!process.env.ANTHROPIC_API_KEY;

    if (!row) {
      return NextResponse.json({
        success: true,
        data: { configured: envKey, source: envKey ? "env" : "none", model: DEFAULT_MODEL },
      });
    }

    const parsed = JSON.parse(row.value) as { apiKey?: string; model?: string };
    const masked = parsed.apiKey
      ? `${parsed.apiKey.slice(0, 8)}…${parsed.apiKey.slice(-4)}`
      : null;

    return NextResponse.json({
      success: true,
      data: {
        configured: !!parsed.apiKey || envKey,
        source: parsed.apiKey ? "settings" : envKey ? "env" : "none",
        apiKeyMasked: masked,
        model: parsed.model || DEFAULT_MODEL,
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
        { success: false, error: "Invalid input. apiKey must be 20+ characters." },
        { status: 400 }
      );
    }

    const existingRow = await prisma.setting.findUnique({ where: { key: KEY_NAME } });
    const existing = existingRow
      ? (JSON.parse(existingRow.value) as { apiKey?: string; model?: string })
      : {};

    const apiKey = parsed.data.apiKey?.trim() || existing.apiKey;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Paste your Anthropic API key to save." },
        { status: 400 }
      );
    }

    // Validate before storing — a bad key saved silently is worse than an error.
    try {
      await listModels(apiKey);
    } catch (e) {
      const detail = e instanceof Error ? e.message : "unknown error";
      return NextResponse.json(
        { success: false, error: `Anthropic rejected that key. ${detail}` },
        { status: 400 }
      );
    }

    const value = JSON.stringify({
      apiKey,
      model: parsed.data.model?.trim() || existing.model || DEFAULT_MODEL,
    });

    await prisma.setting.upsert({
      where: { key: KEY_NAME },
      update: { value },
      create: { key: KEY_NAME, value },
    });

    return NextResponse.json({ success: true, message: "Anthropic settings saved and verified." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await prisma.setting.deleteMany({ where: { key: KEY_NAME } });
    return NextResponse.json({ success: true, message: "Anthropic key removed." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove key";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
