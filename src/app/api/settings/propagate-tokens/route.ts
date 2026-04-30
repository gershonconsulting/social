export const runtime = 'edge';
import { NextResponse } from "next/server";
import { propagateTokensForAllPlatforms } from "@/lib/jobs/token-propagate";

/**
 * POST /api/settings/propagate-tokens
 *
 * One-shot helper Olivier can run after authorizing a platform once. Walks
 * every platform with a CONNECTED row and copies its token onto any sibling
 * connection that's still PENDING / DISCONNECTED with no token. Idempotent
 * — calling it twice is harmless.
 */
export async function POST() {
  try {
    const results = await propagateTokensForAllPlatforms();
    const totalApplied = results.reduce((s, r) => s + r.appliedTo, 0);
    return NextResponse.json({
      success: true,
      data: {
        totalApplied,
        results,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to propagate tokens";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
