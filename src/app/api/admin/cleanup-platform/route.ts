export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { Platform } from "@prisma/client";

/**
 * POST /api/admin/cleanup-platform
 * Body: { platform: "X" } | { platforms: ["X","Y","Z"] }
 *
 * Hard-deletes every platformConnection (and its child posts, compliance,
 * follower-snapshots, schedules) for the given platform(s). Used to drop
 * support for platforms we no longer track.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let targets: string[] = [];
    if (Array.isArray(body?.platforms)) targets = body.platforms.filter((p: unknown) => typeof p === "string");
    else if (typeof body?.platform === "string") targets = [body.platform];
    if (targets.length === 0) {
      return NextResponse.json({ success: false, error: "platform or platforms[] is required" }, { status: 400 });
    }

    const validValues = Object.values(Platform);
    const valid = targets.filter((t) => (validValues as string[]).includes(t)) as Platform[];
    if (valid.length === 0) {
      return NextResponse.json({ success: false, error: "no recognized platforms in request" }, { status: 400 });
    }

    let totalConns = 0, totalPosts = 0, totalCompliance = 0, totalFollowers = 0, totalSchedules = 0;

    for (const platformValue of valid) {
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

      totalConns += removed.count;
      totalPosts += posts.count;
      totalCompliance += compliance.count;
      totalFollowers += followers.count;
      totalSchedules += schedules.count;
    }

    return NextResponse.json({
      success: true,
      data: {
        platforms: valid,
        connectionsRemoved: totalConns,
        socialPostsRemoved: totalPosts,
        complianceRowsRemoved: totalCompliance,
        followerSnapshotsRemoved: totalFollowers,
        postingSchedulesRemoved: totalSchedules,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cleanup failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
