export const runtime = "edge";
import { SITE_HOST } from "@/lib/site";

/**
 * Public liveness check: which product answered, and which build.
 *
 * Deliberately unauthenticated and deliberately empty of data — no session,
 * no tenant scoping, nothing read from the database. It exists so
 * health.gershon.ai can tell "Social is up" from "Social is down" without a
 * login, which until now it could not: every route under /api answered
 * "Not signed in", so an outage and a healthy app looked identical from
 * outside.
 *
 * Same shape and same path as /api/ping on Publish and Social Tracking, so
 * one checker covers all three.
 *
 * Allowlisted in src/middleware.ts under MACHINE_EXACT.
 */
export async function GET() {
  return Response.json(
    {
      ok: true,
      product: "Social",
      host: SITE_HOST,
      build: process.env.NEXT_PUBLIC_BUILD_NUMBER || null,
      commit: (process.env.NEXT_PUBLIC_APP_VERSION || "").slice(0, 7) || null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
