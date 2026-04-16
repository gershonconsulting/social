export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { validateTestApiKey } from "@/lib/test-auth";
import prisma from "@/lib/db";

/**
 * GET /api/test/health
 *
 * Quick health check — is the app alive, can it reach the database,
 * what version is running? This is the first thing OpenClaw should hit.
 *
 * Returns:
 *   - app: version, build date, environment
 *   - database: connected (bool), latency in ms
 *   - timestamp: when the check ran
 */
export async function GET(req: NextRequest) {
  const authError = validateTestApiKey(req);
  if (authError) return authError;

  const start = Date.now();

  // App info
  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE || "unknown";
  const nodeEnv = process.env.NODE_ENV || "unknown";

  // Database connectivity
  let dbConnected = false;
  let dbLatencyMs = -1;
  let dbError: string | null = null;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbConnected = true;
  } catch (error: unknown) {
    dbError = error instanceof Error ? error.message : "Unknown database error";
  }

  const totalMs = Date.now() - start;

  return NextResponse.json({
    success: true,
    data: {
      status: dbConnected ? "healthy" : "degraded",
      app: {
        version: appVersion.length > 8 ? appVersion.slice(0, 7) : appVersion,
        buildDate,
        environment: nodeEnv,
      },
      database: {
        connected: dbConnected,
        latencyMs: dbLatencyMs,
        error: dbError,
      },
      responseTimeMs: totalMs,
      timestamp: new Date().toISOString(),
    },
  });
}
