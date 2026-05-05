export const runtime = 'edge';
import { NextResponse } from "next/server";

/**
 * POST /api/settings/twitter
 *
 * Twitter is no longer auth-based on this platform — we read public profiles
 * via the unauthenticated syndication endpoint (no Developer Portal account
 * required). This endpoint exists only to keep the previous URL working;
 * it returns 200 with an explanatory message.
 */
export async function POST() {
  return NextResponse.json({
    success: true,
    message: "Twitter no longer requires credentials. Public profiles are read via Twitter's syndication endpoint. Just make sure each connection's account URL points to the right @handle.",
  });
}
