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
import { LEGACY_HOSTS, SITE_HOST } from "@/lib/site";

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

/**
 * Exact machine routes (no prefix match). /api/matrix-stats — the weekly Client
 * Platform Matrix email; the route checks the SHA-256 of its own secret.
 */
const MACHINE_EXACT = ["/api/matrix-stats"];

/**
 * v4.65.0 — Social is a COLLECTION platform only (Olivier, 2026-10-26): it
 * collects the posts of the companies a workspace is connected with —
 * clients, partners, competitors, internal. Publishing (content, client
 * review, calendar, Connections, Autopilot, Knowledge Base) lives on
 * Publish. Old links and not-yet-updated extensions are sent there with a
 * 308, which keeps the method, the body and the extension's x-gershon-token
 * header. Nothing below is served by Social any more.
 */
const PUBLISH_ORIGIN = "https://publish.gershon.ai";
const MOVED_TO_PUBLISH = [
  "/publishing",
  "/knowledge-base",
  "/review/",
  "/connect/",
  "/api/publishing/",
  "/api/knowledge-base",
  "/api/review/",
  "/api/media/",
  "/api/connect/",
  "/api/cron/autopilot",
  "/api/cron/publishing-daily",
  "/api/cron/publish-sweep",
];

function movedToPublish(req: NextRequest): NextResponse | null {
  const { pathname, search } = req.nextUrl;
  const hit = MOVED_TO_PUBLISH.some((p) =>
    p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/"),
  );
  return hit ? NextResponse.redirect(`${PUBLISH_ORIGIN}${pathname}${search}`, 308) : null;
}

/**
 * Extensions older than 0.26.0 still ask social.gershon.ai for posts to
 * publish. A redirect would not do for them: they have no permission for
 * publish.gershon.ai, so the browser would block the answer. Until every
 * Chrome runs 0.26.0 (which talks to Publish directly), those calls are
 * passed through to Publish unchanged — Social adds and decides nothing.
 * Sunset: remove once /api/extension/publish/ traffic here is zero.
 */
async function relayToPublish(req: NextRequest): Promise<Response | null> {
  const { pathname, search } = req.nextUrl;
  if (!pathname.startsWith("/api/extension/publish/")) return null;
  const headers = new Headers();
  for (const h of ["content-type", "x-gershon-token", "authorization"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  try {
    const r = await fetch(`${PUBLISH_ORIGIN}${pathname}${search}`, { method: req.method, headers, body, redirect: "manual" });
    return new Response(r.body, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ success: false, error: "Publish is not reachable" }, { status: 502 });
  }
}

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

/**
 * v4.43.0 — the app now lives at social.gershon.ai. On the old host
 * (social.gershoncrm.com) every PAGE, and every GET under /api/auth/ (so a
 * LinkedIn sign-in starts and finishes on the same host), is permanently
 * redirected to the same path on the new host. The rest of /api/* is still
 * served on the old host so not-yet-updated extensions, the scheduled jobs and
 * client.gershoncrm.com keep working.
 */
function legacyRedirect(req: NextRequest): NextResponse | null {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  if (!LEGACY_HOSTS.includes(host)) return null;
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isAuthGet = req.method === "GET" && pathname.startsWith("/api/auth/");
  if (isApi && !isAuthGet) return null;
  if (!isApi && req.method !== "GET" && req.method !== "HEAD") return null;
  return NextResponse.redirect(`https://${SITE_HOST}${pathname}${search}`, 308);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const relayed = await relayToPublish(req);
  if (relayed) return relayed as NextResponse;

  const toPublish = movedToPublish(req);
  if (toPublish) return toPublish;

  const moved = legacyRedirect(req);
  if (moved) return moved;

  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (startsWithAny(pathname, AUTH_PATHS)) return NextResponse.next();
  if (startsWithAny(pathname, MACHINE_PATHS)) return NextResponse.next();
  if (MACHINE_EXACT.includes(pathname)) return NextResponse.next();
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
  // Pages (for the old-domain redirect) and everything under /api (for the
  // session gate). Next's own build assets are left alone.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
