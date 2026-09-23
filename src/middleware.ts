/**
 * The front door.
 *
 * This file used to say "single-user app — no authentication middleware
 * needed" and match nothing, which was true of an internal tool and became
 * false the moment this became a product. Until this commit, every API route
 * except three answered anyone on the internet with no credentials at all:
 * /api/clients returned the whole client book, /api/audit the audit log,
 * /api/dashboard the numbers.
 *
 * It also quietly defeated the tenant scoping. An unauthenticated request has
 * no session, so db.ts hands it the raw client — correct for a cron job, and
 * a hole the size of the database for a stranger with curl.
 *
 * So: everything under /api is now session-only, except the two kinds of
 * caller that legitimately have no session.
 *
 *   MACHINE CALLERS — the cron routes and the report/digest endpoints they
 *   call. Each already checks its own shared secret (CRON_SECRET,
 *   DIGEST_SECRET, HEALTH_SECRET, CAMPAIGN_API_KEY, TEST_API_KEY) and answers
 *   401 without it, so the check stays where it is and this file stays out of
 *   the way. Note that those routes treat an UNSET secret as "no check", which
 *   is a separate thing worth tightening.
 *
 *   THE CHROME EXTENSION, which runs in the operator's browser against
 *   linkedin.com and posts what it collects back here. It has no session and,
 *   today, no credential of its own either. Locking it out would stop
 *   collection dead, so its four endpoints stay open for now and get a
 *   per-workspace token next — that token is also what will tell the ingest
 *   endpoint which tenant the data belongs to.
 *
 * Pages are not gated here. The dashboard layout already redirects an
 * unauthenticated visitor to /login, and /r/<token> share links are meant to
 * be opened by people who are not signed in.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Called by something that is not a browser holding a login, and that proves
 * itself with a shared secret inside the route.
 */
const MACHINE_PATHS = [
  "/api/cron/",
  "/api/digest/",
  "/api/report/",
  "/api/campaigns/attainment",
  "/api/campaigns/monthly",
  "/api/admin/sheets-sync",
  "/api/admin/streak-sync",
  "/api/test/",
];

/** Sign-in itself, including every OAuth callback. */
const AUTH_PATHS = ["/api/auth/"];

/**
 * The Chrome extension. Open until it carries a per-workspace token; see the
 * note at the top of this file.
 */
const EXTENSION_PATHS = ["/api/extension/", "/api/cookies/"];

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (startsWithAny(pathname, AUTH_PATHS)) return NextResponse.next();
  if (startsWithAny(pathname, MACHINE_PATHS)) return NextResponse.next();
  if (startsWithAny(pathname, EXTENSION_PATHS)) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET as string,
  });

  if (!token?.id) {
    return NextResponse.json(
      { success: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // Everything under /api. Static assets and pages are untouched.
  matcher: ["/api/:path*"],
};
