export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { posts } = body;
    
    if (!posts || !Array.isArray(posts)) {
      return NextResponse.json({ success: false, error: "posts array is required" }, { status: 400, headers: corsHeaders });
    }

    // We need to look up clientId from platformConnectionId
    const results = [];
    for (const post of posts) {
      const { platformConnectionId, platform, externalPostId, content, publishedAt, postUrl, likeCount, commentCount, shareCount } = post;
      
      if (!platformConnectionId || !content || !publishedAt) {
        results.push({ error: "platformConnectionId, content, publishedAt required", post: content?.substring(0, 50) });
        continue;
      }

      // Look up the connection to get clientId
      const connection = await prisma.platformConnection.findUnique({
        where: { id: platformConnectionId },
        select: { clientId: true }
      });
      
      if (!connection) {
        results.push({ error: "connection not found", platformConnectionId });
        continue;
      }

      const extId = externalPostId || ("manual_" + Date.now().toString() + "_" + Math.random().toString(36).slice(2));
      
      // Check for existing post
      const existing = await prisma.socialPost.findFirst({
        where: { 
          clientId: connection.clientId,
          platform: (platform as Platform) || Platform.TWITTER,
          externalPostId: extId
        }
      });
      
      if (existing) {
        results.push({ id: existing.id, status: "exists" });
        continue;
      }

      const pubDate = new Date(publishedAt);
      const dateLocal = pubDate.toISOString().split("T")[0];

      const created = await prisma.socialPost.create({
        data: {
          clientId: connection.clientId,
          platformConnectionId,
          platform: (platform as Platform) || Platform.TWITTER,
          externalPostId: extId,
          postTextSnippet: content.substring(0, 2000),
          publishedAtUtc: pubDate,
          publishedAtLocal: pubDate,
          publishedDateLocal: dateLocal,
          postUrl: postUrl || null,
          likeCount: likeCount || 0,
          commentCount: commentCount || 0,
          shareCount: shareCount || 0,
        }
      });
      results.push({ id: created.id, status: "created" });
    }

    return NextResponse.json({ success: true, results, total: results.length }, { headers: corsHeaders });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500, headers: corsHeaders });
  }
}
