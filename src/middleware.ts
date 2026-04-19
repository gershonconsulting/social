import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Single-user app — no authentication middleware needed
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// No matcher = middleware won't run on any routes
export const config = {
  matcher: [],
};
