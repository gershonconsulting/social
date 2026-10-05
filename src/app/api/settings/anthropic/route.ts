export const runtime = "edge";

/**
 * Retired in v4.29.0 — the app runs on Cloudflare Workers AI and needs no
 * anthropic key (Olivier, 2026-10-04). v4.29.0 rewrote lib/content/provider.ts but
 * left this route importing exports that no longer exist, which broke the
 * build. v4.30.0 keeps the URL alive so the Settings page still loads, and
 * answers "not used" instead of storing a key nobody reads.
 */
import { NextResponse } from "next/server";
import { DEFAULT_CF_MODEL } from "@/lib/content/provider";

const RETIRED = "No anthropic key is used: AI runs on Cloudflare Workers AI.";

export async function GET() {
  return NextResponse.json({
    success: true,
    data: { configured: false, source: "none", retired: true, model: DEFAULT_CF_MODEL, message: RETIRED },
  });
}

export async function POST() {
  return NextResponse.json({ success: false, error: RETIRED }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({ success: true, data: { retired: true } });
}
