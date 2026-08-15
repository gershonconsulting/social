/**
 * Content Intelligence endpoint.
 *
 * GET  → statistics (always computed fresh, free) + the cached AI analysis if
 *        one exists for this window.
 * POST → regenerate the AI analysis and cache it.
 *
 * Split this way on purpose: the stats panel must render instantly and must
 * keep working when no API key is configured, while the expensive model call
 * only happens when someone asks for it.
 */

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { buildCorpus } from "@/lib/content/corpus";
import { getAnthropicSettings, runAnalysis } from "@/lib/content/analyze";

const ALLOWED_WINDOWS = [30, 90, 180, 365, 3650];

function parseWindow(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("window") ?? 365);
  return ALLOWED_WINDOWS.includes(raw) ? raw : 365;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const windowDays = parseWindow(req);

    const client = await prisma.client.findUnique({
      where: { id },
      select: { id: true, name: true, industry: true, website: true, clientType: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
    }

    const [{ stats }, cached, settings] = await Promise.all([
      buildCorpus(id, windowDays),
      prisma.contentAnalysis.findUnique({ where: { clientId_windowDays: { clientId: id, windowDays } } }),
      getAnthropicSettings(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        client,
        windowDays,
        stats,
        aiConfigured: !!settings.apiKey,
        analysis: cached
          ? {
              result: JSON.parse(cached.resultJson),
              model: cached.model,
              generatedAt: cached.generatedAt.toISOString(),
              postCount: cached.postCount,
              inputTokens: cached.inputTokens,
              outputTokens: cached.outputTokens,
              durationMs: cached.durationMs,
              stale: cached.postCount !== stats.postCount,
            }
          : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load content analysis";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const windowDays = parseWindow(req);

    const client = await prisma.client.findUnique({
      where: { id },
      select: { id: true, name: true, industry: true, website: true, clientType: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
    }

    const settings = await getAnthropicSettings();
    if (!settings.apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Anthropic API key configured. Go to Settings → Content Intelligence (AI) and paste your key.",
          code: "NO_API_KEY",
        },
        { status: 428 }
      );
    }

    const corpus = await buildCorpus(id, windowDays);
    if (corpus.stats.postCount === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `No collected posts for ${client.name} in the last ${windowDays} days. Run a sync first.`,
          code: "NO_CONTENT",
        },
        { status: 409 }
      );
    }

    const outcome = await runAnalysis(client, corpus, settings);

    const payload = {
      clientId: id,
      windowDays,
      postCount: corpus.stats.postCount,
      platformsJson: JSON.stringify(corpus.stats.platforms.map((p) => p.platform)),
      statsJson: JSON.stringify(corpus.stats),
      resultJson: JSON.stringify(outcome.result),
      model: outcome.model,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      durationMs: outcome.durationMs,
      generatedAt: new Date(),
    };

    const saved = await prisma.contentAnalysis.upsert({
      where: { clientId_windowDays: { clientId: id, windowDays } },
      update: payload,
      create: payload,
    });

    return NextResponse.json({
      success: true,
      data: {
        windowDays,
        stats: corpus.stats,
        aiConfigured: true,
        analysis: {
          result: outcome.result,
          model: outcome.model,
          generatedAt: saved.generatedAt.toISOString(),
          postCount: saved.postCount,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          durationMs: outcome.durationMs,
          stale: false,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
