export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import raw from "@/lib/db-raw";
import { primaryOrgId } from "@/lib/reports/monthly/data";
import { GET as clientsGET } from "@/app/api/clients/route";
import { GET as summaryGET } from "@/app/api/analytics/summary/route";
import { GET as followersGET } from "@/app/api/followers/route";

/**
 * Read-only Promote feed for client.gershoncrm.com (server-to-server).
 *
 *   GET /api/report/promote?resource=clients
 *   GET /api/report/promote?resource=summary&clientId=<id>&days=30
 *   GET /api/report/promote?resource=followers&clientId=<id>
 *
 * Auth: PROMOTE_API_KEY, sent as `Authorization: Bearer <key>` or
 * `x-promote-key: <key>`. If the secret is unset (or too short) every call is
 * refused — an unset key never means "no check" here.
 *
 * Scope: the PRIMARY workspace only (Gershon's own). The request carries no
 * session, so the delegated handlers run on the raw client; the tenant fence
 * is therefore applied here, before delegating:
 *   - clients:            filtered to clients whose organizationId is primary
 *   - summary/followers:  404 unless clientId belongs to the primary workspace
 *
 * Response bodies are exactly those of /api/clients?light=1,
 * /api/analytics/summary and /api/followers, so the caller only changes URL
 * and header.
 */

function keyOk(req: NextRequest): boolean {
  const key = process.env.PROMOTE_API_KEY || "";
  if (key.length < 24) return false;
  const auth = req.headers.get("authorization") || "";
  const given = auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : (req.headers.get("x-promote-key") || "").trim();
  if (given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

function innerRequest(origin: string, path: string, params: URLSearchParams): NextRequest {
  const u = new URL(path, origin);
  params.forEach((v, k) => {
    if (k !== "resource") u.searchParams.set(k, v);
  });
  return new NextRequest(u.toString());
}

export async function GET(req: NextRequest) {
  if (!keyOk(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const resource = (url.searchParams.get("resource") || "clients").toLowerCase();
    const orgId = await primaryOrgId();

    if (resource === "clients") {
      const owned = await raw.client.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      });
      const allowed = new Set(owned.map((c) => c.id));

      const params = new URLSearchParams(url.searchParams);
      params.set("light", "1");
      const res = await clientsGET(innerRequest(url.origin, "/api/clients", params));
      const body = (await res.json()) as { success?: boolean; data?: Array<{ id: string }>; error?: string };
      if (!body?.success || !Array.isArray(body.data)) {
        return NextResponse.json(body ?? { success: false, error: "clients query failed" }, { status: res.status || 500 });
      }
      return NextResponse.json(
        { success: true, data: body.data.filter((c) => allowed.has(c.id)) },
        { headers: { "Cache-Control": "private, max-age=60" } },
      );
    }

    if (resource === "summary" || resource === "followers") {
      const clientId = url.searchParams.get("clientId");
      if (!clientId) {
        return NextResponse.json({ success: false, error: "clientId is required" }, { status: 400 });
      }
      const owned = await raw.client.findFirst({
        where: { id: clientId, organizationId: orgId },
        select: { id: true },
      });
      if (!owned) {
        return NextResponse.json({ success: false, error: "Unknown client" }, { status: 404 });
      }
      if (resource === "summary") {
        return summaryGET(innerRequest(url.origin, "/api/analytics/summary", url.searchParams));
      }
      return followersGET(innerRequest(url.origin, "/api/followers", url.searchParams));
    }

    return NextResponse.json(
      { success: false, error: "resource must be clients, summary or followers" },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "promote feed failed" },
      { status: 500 },
    );
  }
}
