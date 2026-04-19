export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { posts } = body;
    
    if (!posts || !Array.isArray(posts)) {
      return NextResponse.json({ success: false, error: "posts array is required" }, { status: 400 });
    }

    const results = [];
    for (const post of posts) {
      const { connectionId, platform, externalPostId, content, publishedAt, postUrl, postType, likes, comments, shares, views } = post;
      
      if (!connectionId || !content || !publishedAt) {
        results.push({ error: "connectionId, content, publishedAt required", post: content?.substring(0, 50) });
        continue;
      }
      
      const extId = externalPostId || `manual_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      // Check for existing post to avoid duplicates
      const existing = await prisma.socialPost.findFirst({
        where: { connectionId, externalPostId: extId }
      });
      
      if (existing) {
        results.push({ id: existing.id, status: "exists" });
        continue;
      }

      const created = await prisma.socialPost.create({
        data: {
          connectionId,
          platform: (platform as Platform) || Platform.TWITTER,
          externalPostId: extId,
          content,
          publishedAt: new Date(publishedAt),
          postUrl: postUrl || null,
          postType: postType || "ORIGINAL",
          likes: likes || 0,
          comments: comments || 0,
          shares: shares || 0,
          views: views || 0,
        }
      });
      results.push({ id: created.id, status: "created" });
    }

    return NextResponse.json({ success: true, results, total: results.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
