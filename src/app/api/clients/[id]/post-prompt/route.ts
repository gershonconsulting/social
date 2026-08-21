/**
 * Post Studio endpoint.
 *
 * GET  → the cached brief for this window, if one exists, plus enough coverage
 *        numbers for the panel to explain itself before anything is generated.
 * POST → generate the brief and cache it.
 *
 * CAMPAIGN companies only. That is a product rule, not a UI convenience, so it
 * is enforced here: a non-campaign company gets 403 NOT_CAMPAIGN whichever way
 * the request arrives.
 */

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { buildCorpus } from "@/lib/content/corpus";
import { getAnthropicSettings, runPostPrompt } from "@/lib/content/post-prompt";
import type { AnalysisResult } from "@/lib/content/analyze";

const ALLOWED_WINDOWS = [30, 90, 180, 365, 3650];

function parseWindow(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("window") ?? 365);
  return ALLOWED_WINDOWS.includes(raw) ? raw : 365;
}

type ClientRow = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  clientType: string;
};

async function loadCampaignClient(id: string): Promise<
  { ok: true; client: ClientRow } | { ok: false; res: NextResponse }
> {
  const client = (await prisma.client.findUnique({
    where: { id },
    select: { id: true, name: true, industry: true, website: true, clientType: true },
  })) as ClientRow | null;

  if (!client) {
    return {
      ok: false,
      res: NextResponse.json({ success: false, error: "Company not found" }, { status: 404 }),
    };
  }

  if (client.clientType !== "CAMPAIGN") {
    return {
      ok: false,
      res: NextResponse.json(
        {
          success: false,
          error: `Post Studio is only available for CAMPAIGN companies. ${client.name} is categorized as ${client.clientType}.`,
          code: "NOT_CAMPAIGN",
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true, client };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const windowDays = parseWindow(req);

    const loaded = await loadCampaignClient(id);
    if (!loaded.ok) return loaded.res;

    const [{ stats }, cached, settings] = await Promise.all([
      buildCorpus(id, windowDays),
      prisma.postPrompt.findUnique({
        where: { clientId_windowDays: { clientId: id, windowDays } },
      }),
      getAnthropicSettings(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        client: loaded.client,
        windowDays,
        aiConfigured: !!settings.apiKey,
        coverage: {
          postCount: stats.postCount,
          firstPostDate: stats.firstPostDate,
          lastPostDate: stats.lastPostDate,
          avgEngagement: stats.avgEngagement,
          medianEngagement: stats.medianEngagement,
          hashtagRate: stats.hashtagRate,
          distinctHashtags: stats.hashtags.length,
        },
        brief: cached
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
    const message = err instanceof Error ? err.message : "Failed to load the post brief";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const windowDays = parseWindow(req);

    const loaded = await loadCampaignClient(id);
    if (!loaded.ok) return loaded.res;
    const client = loaded.client;

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

    // Reuse the editorial read if Content Intelligence has already produced one
    // for this window — same corpus, so the brief should agree with it rather
    // than re-deriving positioning from scratch.
    let priorAnalysis: AnalysisResult | null = null;
    try {
      const existing = await prisma.contentAnalysis.findUnique({
        where: { clientId_windowDays: { clientId: id, windowDays } },
        select: { resultJson: true },
      });
      if (existing) priorAnalysis = JSON.parse(existing.resultJson) as AnalysisResult;
    } catch {
      // A missing or unparseable analysis must never block the brief.
      priorAnalysis = null;
    }

    const outcome = await runPostPrompt(client, corpus, settings, priorAnalysis);

    const payload = {
      clientId: id,
      windowDays,
      postCount: corpus.stats.postCount,
      promptText: outcome.result.promptText,
      resultJson: JSON.stringify(outcome.result),
      model: outcome.model,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      durationMs: outcome.durationMs,
      generatedAt: new Date(),
    };

    const saved = await prisma.postPrompt.upsert({
      where: { clientId_windowDays: { clientId: id, windowDays } },
      update: payload,
      create: payload,
    });

    return NextResponse.json({
      success: true,
      data: {
        windowDays,
        aiConfigured: true,
        coverage: {
          postCount: corpus.stats.postCount,
          firstPostDate: corpus.stats.firstPostDate,
          lastPostDate: corpus.stats.lastPostDate,
          avgEngagement: corpus.stats.avgEngagement,
          medianEngagement: corpus.stats.medianEngagement,
          hashtagRate: corpus.stats.hashtagRate,
          distinctHashtags: corpus.stats.hashtags.length,
        },
        brief: {
          result: outcome.result,
          model: outcome.model,
          generatedAt: saved.generatedAt.toISOString(),
          postCount: saved.postCount,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          durationMs: outcome.durationMs,
          stale: false,
        },
        usedPriorAnalysis: !!priorAnalysis,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brief generation failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
