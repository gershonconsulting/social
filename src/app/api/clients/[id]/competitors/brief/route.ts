/**
 * Competitor Watch — AI brief.
 *
 * POST ?window=90 → sends the pre-computed comparison (never raw dumps) to the
 * configured AI provider and caches the answer per company per window.
 */

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { buildCompetitorWatch } from "@/lib/competitors/analyze";
import { getCompetitorIds, requireOrgId, saveBrief } from "@/lib/competitors/store";
import { getAISettings, runChat } from "@/lib/content/provider";

const ALLOWED_WINDOWS = [30, 90, 180, 365];

const SYSTEM = `You are a B2B social-media strategist. You compare one company's LinkedIn/X content with its competitors'.
You receive pre-computed statistics (posting frequency, theme shares, keywords, hashtags, top posts) for the company and each competitor.
Answer ONLY with a JSON object, no prose around it, with this shape:
{
  "headline": string,                          // one sentence: the single most important finding
  "competitors": [ { "name": string, "positioning": string, "whatTheyPost": string, "signatureKeywords": string[], "cadence": string, "threatLevel": "high"|"medium"|"low" } ],
  "sharedPlaybook": string[],                  // what most competitors do
  "whiteSpace": string[],                      // subjects / angles nobody owns that the company could own
  "whereCompanyLags": string[],
  "whereCompanyLeads": string[],
  "recommendations": [ { "action": string, "why": string, "priority": "high"|"medium"|"low" } ],
  "postIdeas": [ { "hook": string, "angle": string, "hashtags": string[] } ]   // 5 ideas
}
Base every claim on the numbers given. If a competitor has 0 posts in the window, say data is missing rather than guessing.`;

function slim(c: Awaited<ReturnType<typeof buildCompetitorWatch>>["self"]) {
  return {
    name: c.name,
    posts: c.postCount,
    postsPerWeek: c.postsPerWeek,
    activeWeeks: `${c.activeWeeks}/${c.weeksInWindow}`,
    daysSinceLastPost: c.daysSinceLastPost,
    avgEngagement: c.avgEngagement,
    mediaRate: c.mediaRate,
    bestWeekday: c.bestWeekday,
    themes: c.themes.filter((t) => t.count > 0).map((t) => `${t.label} ${t.share}%`),
    keywords: c.keywords.slice(0, 15).map((k) => `${k.term}(${k.count})`),
    phrases: c.phrases.slice(0, 8).map((k) => k.term),
    hashtags: c.hashtags.slice(0, 10).map((k) => `#${k.term}`),
    topPosts: c.topPosts.map((p) => ({ date: p.date, engagement: p.engagement, text: p.text.slice(0, 220) })),
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const raw = Number(req.nextUrl.searchParams.get("window") ?? 90);
    const windowDays = ALLOWED_WINDOWS.includes(raw) ? raw : 90;

    const client = await prisma.client.findUnique({ where: { id }, select: { id: true, name: true, industry: true } });
    if (!client) return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });

    const settings = await getAISettings();
    if (!settings.apiKey) {
      return NextResponse.json(
        { success: false, code: "NO_API_KEY", error: "No AI key configured. Add one in Settings → Content Intelligence (AI)." },
        { status: 428 }
      );
    }

    const orgId = await requireOrgId();
    const ids = await getCompetitorIds(orgId, id);
    if (!ids.length) {
      return NextResponse.json({ success: false, error: "Add at least one competitor first." }, { status: 409 });
    }
    const rows = await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const watch = await buildCompetitorWatch(client, rows, windowDays);

    const payload = {
      company: client.name,
      industry: client.industry,
      windowDays,
      self: slim(watch.self),
      competitors: watch.competitors.map(slim),
      keywordGaps: watch.gaps.slice(0, 12).map((g) => `${g.term} (used by ${g.competitors})`),
      ownedKeywords: watch.owned.map((k) => k.term),
      themeComparison: watch.themeComparison,
    };

    const started = Date.now();
    const out = await runChat(settings, SYSTEM, JSON.stringify(payload), 5000);
    const text = out.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let result: unknown;
    try {
      result = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      return NextResponse.json({ success: false, error: "The AI answer was not valid JSON. Try again." }, { status: 502 });
    }

    const brief = {
      result,
      model: out.model,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      postCounts: [watch.self, ...watch.competitors].map((c) => c.postCount).join(","),
    };
    await saveBrief(orgId, id, windowDays, brief);
    return NextResponse.json({ success: true, data: { brief } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brief failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
