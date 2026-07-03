export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType } from "@prisma/client";
import { slugify } from "@/lib/utils";
import {
  listPipelines,
  fetchCurrentClients,
  type CurrentClient,
} from "@/lib/streak";

/**
 * Streak → Social client sync.
 *
 * Reads the current clients out of our Streak "Clients" pipeline and upserts
 * them into the Client table, keyed by the Streak boxKey (stable id). Keeps
 * Social's client list in sync without anyone re-typing it.
 *
 * ── GET /api/admin/streak-sync?discover=1 ──────────────────────────────────
 *   Discovery mode. Returns every pipeline with its stages so you can find
 *   the client pipelineKey and which stageKey means "current/active". Set
 *   those as STREAK_CLIENT_PIPELINE_KEY and STREAK_CURRENT_STAGE_KEYS. No DB
 *   writes. (Requires STREAK_API_KEY.)
 *
 * ── POST /api/admin/streak-sync ────────────────────────────────────────────
 *   Runs the sync. For each current client:
 *     - match existing Client by streakBoxKey, else by slug, else create;
 *     - fill name / streakStageKey; set clientType=CLIENT, status=ACTIVE.
 *   Idempotent. Never deletes — clients that drop out of the current stage
 *   are reported under `staleInDb` for manual review (we don't auto-archive).
 *
 * Env:
 *   STREAK_API_KEY               (required) — server-side secret.
 *   STREAK_CLIENT_PIPELINE_KEY   (required for POST) — the Clients pipeline.
 *   STREAK_CURRENT_STAGE_KEYS    (optional) — comma-separated "current" stages.
 *                                 Omit to sync every box regardless of stage.
 *
 * Auth: same CRON_SECRET Bearer pattern as the other admin/cron routes.
 * Same-origin calls with no Authorization header are allowed (parity with
 * /api/admin/sheets-sync).
 */

function checkAuth(req: NextRequest): NextResponse | null {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (auth) {
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  return null;
}

// GET — discovery only.
export async function GET(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const discover = req.nextUrl.searchParams.get("discover");
  if (!discover) {
    return NextResponse.json(
      { success: false, error: "Use ?discover=1 to list pipelines, or POST to run the sync." },
      { status: 400 },
    );
  }

  try {
    const pipelines = await listPipelines();
    const data = pipelines.map((p) => ({
      pipelineKey: p.pipelineKey,
      name: p.name,
      stages: Object.entries(p.stages ?? {}).map(([key, s]) => ({
        stageKey: key,
        name: s?.name ?? "",
      })),
    }));
    return NextResponse.json({ success: true, data: { pipelines: data } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "discover failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST — run the sync.
export async function POST(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  let current: CurrentClient[];
  try {
    current = await fetchCurrentClients();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Streak fetch failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  const results: Array<{
    boxKey: string; name: string; clientId: string; action: "created" | "updated" | "linked";
  }> = [];
  const errors: Array<{ boxKey: string; name: string; error: string }> = [];

  try {
    for (const c of current) {
      try {
        // 1) Already linked by boxKey?
        let client = await prisma.client.findUnique({ where: { streakBoxKey: c.boxKey } });
        if (client) {
          await prisma.client.update({
            where: { id: client.id },
            data: { name: c.name, streakStageKey: c.stageKey ?? null },
          });
          results.push({ boxKey: c.boxKey, name: c.name, clientId: client.id, action: "updated" });
          continue;
        }

        // 2) Not linked yet — match an existing client by slug and adopt it.
        const baseSlug = slugify(c.name) || `streak-${c.boxKey.slice(-8)}`;
        const bySlug = await prisma.client.findUnique({ where: { slug: baseSlug } });
        if (bySlug && !bySlug.streakBoxKey) {
          client = await prisma.client.update({
            where: { id: bySlug.id },
            data: { streakBoxKey: c.boxKey, streakStageKey: c.stageKey ?? null, name: c.name },
          });
          results.push({ boxKey: c.boxKey, name: c.name, clientId: client.id, action: "linked" });
          continue;
        }

        // 3) Create. Ensure a unique slug (append boxKey suffix on collision).
        const slug = bySlug ? `${baseSlug}-${c.boxKey.slice(-6).toLowerCase()}` : baseSlug;
        client = await prisma.client.create({
          data: {
            name: c.name,
            slug,
            timezone: "America/New_York",
            status: ClientStatus.ACTIVE,
            clientType: ClientType.CLIENT,
            streakBoxKey: c.boxKey,
            streakStageKey: c.stageKey ?? null,
          },
        });
        results.push({ boxKey: c.boxKey, name: c.name, clientId: client.id, action: "created" });
      } catch (inner) {
        errors.push({
          boxKey: c.boxKey,
          name: c.name,
          error: inner instanceof Error ? inner.message : "upsert failed",
        });
      }
    }

    // Report Streak-sourced clients that are no longer in the current set,
    // so Olivier can archive them by hand (we never auto-archive).
    const currentKeys = new Set(current.map((c) => c.boxKey));
    const linked = await prisma.client.findMany({
      where: { streakBoxKey: { not: null }, status: { not: ClientStatus.ARCHIVED } },
      select: { id: true, name: true, streakBoxKey: true },
    });
    const staleInDb = linked
      .filter((c) => c.streakBoxKey && !currentKeys.has(c.streakBoxKey))
      .map((c) => ({ clientId: c.id, name: c.name, streakBoxKey: c.streakBoxKey }));

    return NextResponse.json({
      success: true,
      data: {
        fetched: current.length,
        created: results.filter((r) => r.action === "created").length,
        linked: results.filter((r) => r.action === "linked").length,
        updated: results.filter((r) => r.action === "updated").length,
        errors: errors.length,
        results,
        errorDetails: errors,
        staleInDb,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "streak-sync failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
