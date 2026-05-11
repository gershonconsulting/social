import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export const runtime = "edge";

// Common industry hashtags for suggestions
const INDUSTRY_HASHTAGS: Record<string, string[]> = {
  default: [
    "leadership", "innovation", "growth", "strategy", "teamwork",
    "success", "motivation", "business", "networking", "community",
  ],
  tech: [
    "AI", "machinelearning", "cloud", "cybersecurity", "devops",
    "blockchain", "SaaS", "startup", "coding", "data",
  ],
  marketing: [
    "contentmarketing", "SEO", "socialmedia", "branding", "digitalmarketing",
    "marketingstrategy", "engagement", "analytics", "ROI", "campaigns",
  ],
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
  const { id } = await params;

  // Cap at the last 500 posts. Past that we're paying CPU for a long tail
  // of duplicates that don't change the cloud — and on Cloudflare Workers
  // the unbounded findMany has been blowing through the CPU budget.
  const posts = await prisma.socialPost.findMany({
    where: { clientId: id },
    select: {
      hashtags: true,
      publishedDateLocal: true,
    },
    orderBy: { publishedDateLocal: "desc" },
    take: 500,
  });

  const tagMap = new Map<string, { count: number; lastUsed: string }>();

  for (const post of posts) {
    if (!post.hashtags) continue;

    let tags: string[] = [];
    try {
      tags = JSON.parse(post.hashtags);
    } catch {
      tags = post.hashtags
        .split(/[,\s#]+/)
        .map((t: string) => t.trim().toLowerCase())
        .filter(Boolean);
    }

    for (const tag of tags) {
      const clean = tag.replace(/^#/, "").toLowerCase();
      if (!clean || clean.length < 2) continue;

      const existing = tagMap.get(clean);
      if (existing) {
        existing.count++;
        if (post.publishedDateLocal && post.publishedDateLocal > existing.lastUsed) {
          existing.lastUsed = post.publishedDateLocal;
        }
      } else {
        tagMap.set(clean, {
          count: 1,
          lastUsed: post.publishedDateLocal || new Date().toISOString().split("T")[0],
        });
      }
    }
  }

  const hashtags = Array.from(tagMap.entries())
    .map(([tag, data]) => ({ tag, ...data }))
    .sort((a, b) => b.count - a.count);

  const usedTags = new Set(hashtags.map((h) => h.tag));
  const allSuggestions = [
    ...INDUSTRY_HASHTAGS.default,
    ...INDUSTRY_HASHTAGS.marketing,
  ];
  const suggestions = allSuggestions
    .filter((tag) => !usedTags.has(tag.toLowerCase()))
    .slice(0, 10);

  return NextResponse.json({ hashtags, suggestions });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load hashtags";
    return NextResponse.json({ success: false, error: message, hashtags: [], suggestions: [] }, { status: 500 });
  }
}
