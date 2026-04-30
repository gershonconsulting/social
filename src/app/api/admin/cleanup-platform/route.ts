export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

/**
 * POST /api/admin/cleanup-platform
 * Body: { platform: "YOUTUBE" }
 *
 * One-shot helper to remove every platformConnection (and its child posts,
 * compliance, follower-snapshots, schedules) for a given platform that we no
 * longer support. Used by Olivier to drop YouTube data wholesale after the
 * UI references were removed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const platform = body?.platform as string | undefined;
    if (!platform) {
      return NextResponse.json({ success: false, error: "platform is required" }, { status: 400 });
    }

    // Validate it's a real Platform enum value (avoid arbitrary string deletions)
    const platformValue = platform as Platform;
    if (!Object.values(Platform).includes(platformValue)) {
      return NextResponse.json({ success: false, error: `Unknown platform: ${platform}` }, { status: 400 });
    }

    const conns = await prisma.platformConnection.findMany({
      where: { platform: platformValue },
      select: { id: true },
    });
    const connIds = conns.map((c) => c.id);

    const [posts, compliance, followers, schedules, removed] = await prisma.$transaction([
      prisma.socialPost.deleteMany({ where: { platform: platformValue } }),
      prisma.dailyCompliance.deleteMany({ where: { platform: platformValue } }),
      prisma.followerSnapshot.deleteMany({ where: { platform: platformValue } }),
      prisma.postingSchedule.deleteMany({ where: { platformConnectionId: { in: connIds } } }),
      prisma.platformConnection.deleteMany({ where: { platform: platformValue } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        platform,
        connectionsRemoved: removed.count,
        socialPostsRemoved: posts.count,
        complianceRowsRemoved: compliance.count,
        followerSnapshotsRemoved: followers.count,
        postingSchedulesRemoved: schedules.count,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cleanup failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
