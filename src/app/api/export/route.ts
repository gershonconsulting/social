export const runtime = "edge";

/**
 * GET /api/export — v4.30.0. Download everything the workspace has collected.
 *
 *   dataset       posts | followers | companies          (default posts)
 *   clientIds     comma-separated company ids             (optional)
 *   category      CLIENT | CAMPAIGN | COMPETITION | …     (optional)
 *   competitorsOf a company id: that company + every company linked to it
 *                 in Competitor Watch                      (optional)
 *   from, to      YYYY-MM-DD, inclusive, on the local post date (optional)
 *   format        csv (download, default) | count (JSON row count for the UI)
 *   workspace     another workspace's id or name — PLATFORM ADMIN ONLY (the
 *                 admin of the primary Gershon workspace, v4.31.0). Lets the
 *                 operator pull a client workspace's data (e.g. VALOS and the
 *                 competitors it tracks) for a campaign review. Everyone else
 *                 gets 403; nobody can read another workspace any other way.
 *
 * No filter at all = the whole workspace. Scoped to the caller's workspace by
 * an explicit organizationId on every query — this route talks to Postgres over
 * the Neon HTTP driver (no Prisma engine, so a big export can't hit Error 1102)
 * and therefore does NOT get db.ts's automatic tenant filter; the org check
 * below is the filter. Session-only: middleware.ts already refuses /api/* with
 * no login.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentOrgId } from "@/lib/scoped-db";
import { query } from "@/lib/sql-http";
import { toCsv, type CsvValue } from "@/lib/export/csv";
import { UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { adminScopeFor } from "@/lib/admin-scope";

const CATEGORIES = new Set([
  "CLIENT", "PARTNER", "PROSPECT", "INTERNAL", "COMPETITION", "COMPANY", "CAMPAIGN", "RECYCLED",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_ROWS = 100_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

async function competitorIds(orgId: string, clientId: string): Promise<string[]> {
  const rows = await query<{ value: string }>(
    `SELECT "value" FROM org_settings WHERE "organizationId" = $1 AND "key" = $2 LIMIT 1`,
    [orgId, `competitors:${clientId}`],
  );
  if (!rows.length) return [];
  try {
    const v = JSON.parse(rows[0].value);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && ID_RE.test(x)) : [];
  } catch {
    return [];
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "export";
}

export async function GET(req: NextRequest) {
  try {
    const ownOrgId = await getCurrentOrgId();
    if (!ownOrgId) {
      return NextResponse.json({ success: false, error: "No workspace for this account" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;

    // Cross-workspace read: platform admin only, checked against the DB-fresh
    // role and workspace (requireRole / adminScopeFor), never the token.
    let orgId = ownOrgId;
    const wanted = (sp.get("workspace") || "").trim();
    if (wanted) {
      let isPlatformAdmin = false;
      try {
        const actor = await requireRole(UserRole.ADMIN);
        isPlatformAdmin = (await adminScopeFor(actor)).isPlatformAdmin;
      } catch {
        isPlatformAdmin = false;
      }
      if (!isPlatformAdmin) {
        return NextResponse.json({ success: false, error: "Platform admins only" }, { status: 403 });
      }
      const orgs = await query<{ id: string }>(
        `SELECT id FROM organizations WHERE id = $1 OR lower(name) = lower($1) OR lower(slug) = lower($1) LIMIT 2`,
        [wanted],
      );
      if (orgs.length !== 1) {
        return NextResponse.json({ success: false, error: "Workspace not found (or ambiguous)" }, { status: 404 });
      }
      orgId = orgs[0].id;
    }
    const dataset = (sp.get("dataset") || "posts").toLowerCase();
    if (!["posts", "followers", "companies"].includes(dataset)) {
      return NextResponse.json({ success: false, error: "dataset must be posts, followers or companies" }, { status: 400 });
    }
    const format = (sp.get("format") || "csv").toLowerCase();
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
      return NextResponse.json({ success: false, error: "from/to must be YYYY-MM-DD" }, { status: 400 });
    }
    const category = (sp.get("category") || "").toUpperCase();
    if (category && !CATEGORIES.has(category)) {
      return NextResponse.json({ success: false, error: "Unknown category" }, { status: 400 });
    }

    // Company selection. All ids are re-checked against the workspace in SQL.
    let ids = (sp.get("clientIds") || "").split(",").map((s) => s.trim()).filter((s) => ID_RE.test(s));
    const competitorsOf = sp.get("competitorsOf") || "";
    let label = category ? category.toLowerCase() : "all";
    if (competitorsOf && ID_RE.test(competitorsOf)) {
      ids = Array.from(new Set([...ids, competitorsOf, ...(await competitorIds(orgId, competitorsOf))]));
      const named = await query<{ name: string }>(
        `SELECT name FROM clients WHERE id = $1 AND "organizationId" = $2`,
        [competitorsOf, orgId],
      );
      label = named[0] ? `${slug(named[0].name)}-and-competitors` : label;
    } else if (ids.length) {
      label = ids.length === 1 ? "company" : `${ids.length}-companies`;
    }

    // Shared company filter: $1 = org, then optional ids / category.
    const params: unknown[] = [orgId];
    let companyWhere = `c."organizationId" = $1`;
    if (ids.length) {
      params.push(ids);
      companyWhere += ` AND c.id = ANY($${params.length})`;
    }
    if (category) {
      params.push(category);
      companyWhere += ` AND c."clientType"::text = $${params.length}`;
    }

    let header: string[] = [];
    let rows: CsvValue[][] = [];

    if (dataset === "posts") {
      let dateWhere = "";
      if (from) { params.push(from); dateWhere += ` AND p."publishedDateLocal" >= $${params.length}`; }
      if (to) { params.push(to); dateWhere += ` AND p."publishedDateLocal" <= $${params.length}`; }
      const sqlText = `
        SELECT c.name AS company, c."clientType"::text AS category, p.platform::text AS platform,
               p."publishedDateLocal" AS date_local, p."publishedAtUtc" AS published_utc,
               p."postUrl" AS url, COALESCE(p."postTextFull", p."postTextSnippet") AS text,
               p.hashtags, p."hasMedia" AS has_media, p."likeCount" AS likes,
               p."commentCount" AS comments, p."shareCount" AS shares, p."viewCount" AS views,
               p."importedAt" AS collected_at
          FROM social_posts p
          JOIN clients c ON c.id = p."clientId"
         WHERE ${companyWhere} AND p."organizationId" = $1 ${dateWhere}
         ORDER BY c.name, p."publishedAtUtc" DESC
         LIMIT ${MAX_ROWS}`;
      if (format === "count") {
        const n = await query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM social_posts p JOIN clients c ON c.id = p."clientId"
            WHERE ${companyWhere} AND p."organizationId" = $1 ${dateWhere}`, params);
        return NextResponse.json({ success: true, data: { dataset, rows: Number(n[0]?.n || 0) } });
      }
      const r = await query<Row>(sqlText, params);
      header = ["company", "category", "platform", "date_local", "published_utc", "url", "text",
        "hashtags", "has_media", "likes", "comments", "shares", "views", "engagement", "collected_at"];
      rows = r.map((x) => [x.company, x.category, x.platform, x.date_local, x.published_utc, x.url,
        x.text, x.hashtags, x.has_media, x.likes, x.comments, x.shares, x.views,
        Number(x.likes || 0) + Number(x.comments || 0) + Number(x.shares || 0), x.collected_at]);
    }

    if (dataset === "followers") {
      let dateWhere = "";
      if (from) { params.push(from); dateWhere += ` AND f."snapshotDateLocal" >= $${params.length}`; }
      if (to) { params.push(to); dateWhere += ` AND f."snapshotDateLocal" <= $${params.length}`; }
      const where = `${companyWhere} AND f."organizationId" = $1 ${dateWhere}`;
      if (format === "count") {
        const n = await query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM follower_snapshots f JOIN clients c ON c.id = f."clientId" WHERE ${where}`, params);
        return NextResponse.json({ success: true, data: { dataset, rows: Number(n[0]?.n || 0) } });
      }
      const r = await query<Row>(
        `SELECT c.name AS company, c."clientType"::text AS category, f.platform::text AS platform,
                f."snapshotDateLocal" AS date_local, f."followerCount" AS followers,
                f."followingCount" AS following
           FROM follower_snapshots f JOIN clients c ON c.id = f."clientId"
          WHERE ${where}
          ORDER BY c.name, f.platform, f."snapshotDateLocal"
          LIMIT ${MAX_ROWS}`, params);
      header = ["company", "category", "platform", "date_local", "followers", "following"];
      rows = r.map((x) => [x.company, x.category, x.platform, x.date_local, x.followers, x.following]);
    }

    if (dataset === "companies") {
      const r = await query<Row>(
        `SELECT c.name AS company, c."clientType"::text AS category, c.status::text AS status,
                c.website, c.industry,
                (SELECT pc."externalAccountUrl" FROM platform_connections pc
                  WHERE pc."clientId" = c.id AND pc.platform::text = 'LINKEDIN' LIMIT 1) AS linkedin,
                (SELECT pc."externalAccountUrl" FROM platform_connections pc
                  WHERE pc."clientId" = c.id AND pc.platform::text = 'TWITTER' LIMIT 1) AS x,
                (SELECT COUNT(*) FROM social_posts p WHERE p."clientId" = c.id AND p."organizationId" = $1) AS posts,
                (SELECT MIN(p."publishedDateLocal") FROM social_posts p WHERE p."clientId" = c.id AND p."organizationId" = $1) AS first_post,
                (SELECT MAX(p."publishedDateLocal") FROM social_posts p WHERE p."clientId" = c.id AND p."organizationId" = $1) AS last_post,
                (SELECT f."followerCount" FROM follower_snapshots f
                  WHERE f."clientId" = c.id AND f.platform::text = 'LINKEDIN'
                  ORDER BY f."snapshotDateLocal" DESC LIMIT 1) AS linkedin_followers
           FROM clients c
          WHERE ${companyWhere}
          ORDER BY c."clientType", c.name`, params);
      if (format === "count") {
        return NextResponse.json({ success: true, data: { dataset, rows: r.length } });
      }
      header = ["company", "category", "status", "website", "industry", "linkedin", "x",
        "posts", "first_post", "last_post", "linkedin_followers"];
      rows = r.map((x) => [x.company, x.category, x.status, x.website, x.industry, x.linkedin, x.x,
        x.posts, x.first_post, x.last_post, x.linkedin_followers]);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const range = from || to ? `-${from || "start"}_${to || stamp}` : "";
    const filename = `social-${dataset}-${label}${range}-${stamp}.csv`;
    return new NextResponse(toCsv(header, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Export-Rows": String(rows.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
