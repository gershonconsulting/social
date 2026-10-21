/**
 * Content Intelligence AI status — Cloudflare Workers AI (v4.29.0).
 *
 * GET  → { provider, model, available, ok, error? } — `ok` comes from a tiny
 *        live call so Settings can show a real green check, not a guess.
 * POST → { model } saves a model override (must be an @cf/ model id).
 */

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAISettings, listModels, pingAI, setModel } from "@/lib/content/provider";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";

// v4.59.0 audit: mutating routes need OPERATIONS or above (ADMIN — the owner —
// keeps access). Middleware already makes /api session-only; this adds the role.
async function guardRole(): Promise<NextResponse | null> {
  try {
    await requireRole(UserRole.OPERATIONS);
    return null;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "FORBIDDEN") return NextResponse.json({ success: false, error: "You do not have permission to do this" }, { status: 403 });
    return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
  }
}

const schema = z.object({ model: z.string().regex(/^@cf\//, "Model id must start with @cf/") });

export async function GET() {
  try {
    const [settings, ping, models] = await Promise.all([getAISettings(), pingAI(), listModels()]);
    return NextResponse.json({
      success: true,
      data: {
        provider: "cloudflare",
        model: ping.ok ? ping.model : settings.model,
        available: settings.available,
        ok: ping.ok,
        error: ping.error ?? null,
        models: models.map((m) => m.id),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read the AI status";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardRole(); // v4.59.0 audit: role check
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Bad model" }, { status: 400 });
  }
  await setModel(parsed.data.model);
  return NextResponse.json({ success: true, message: `Model set to ${parsed.data.model}.`, data: { model: parsed.data.model } });
}
