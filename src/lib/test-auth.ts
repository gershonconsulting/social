/**
 * Test API authentication middleware.
 * Validates the X-API-Key header against the TEST_API_KEY environment variable.
 *
 * Usage in any /api/test/* route:
 *   const authError = validateTestApiKey(req);
 *   if (authError) return authError;
 */

import { NextRequest, NextResponse } from "next/server";

export function validateTestApiKey(req: NextRequest): NextResponse | null {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = process.env.TEST_API_KEY;

  if (!expectedKey) {
    return NextResponse.json(
      {
        success: false,
        error: "TEST_API_KEY not configured on this environment",
      },
      { status: 503 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing X-API-Key header",
      },
      { status: 401 }
    );
  }

  if (apiKey !== expectedKey) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid API key",
      },
      { status: 403 }
    );
  }

  return null; // auth passed
}
