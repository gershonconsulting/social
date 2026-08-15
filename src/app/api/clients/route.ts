export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType, ConnectionStatus, Platform } from "@prisma/client";
import { propagateTokensForAllPlatforms } from "@/lib/jobs/token-propagate";
import { z } from "zod";

const platformConnectionSchema = z.object({
  platform: z.string(),
  externalAccountUrl: z.string().url().optional(),
});

const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  timezone: z.string().default("America/New_York"),
  status: z.nativeEnum(ClientStatus).default(ClientStatus.ACTIVE),
  clientType: z.nativeEnum(ClientType).default(ClientType.CLIENT),
  campaignStartDate: z.string().datetime().optional().nullable(),
  reportingStartDate: z.string().datetime().optional().nullable(),
  internalOwner: z.string().optional().nullable(),
  website: z.string().url().optional().nullable(),
  industry: z.string().optional().nullable(),
  billingStatus: z.string().optional().nullable(),
  contractStatus: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  platformConnections: z.array(platformConnectionSchema).optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const includeArchived = searchParams.get("includeArchived") === "true";

  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status;
  } else if (!includeArchived) {
    where.status = { not: ClientStatus.ARCHIVED };
  }
  const clientType = searchParams.get("clientType");
  if (clientType) {
    where.clientType = clientType;
  }
  // ?light=1 skips the per-client latestPost enrichment. Used by the /clients
  // table view, which doesn't need post snippets and was timing out on the
  // edge runtime when fetching all socialPost rows across every company.
  const light = searchParams.get("light") === "1" || searchParams.get("light") === "true";

  // Edge runtime CPU note: Prisma's nested `include` serializes joins
  // through the data-proxy worker and was occasionally exhausting CPU on
  // the /admin path (intermittent 500/1101). Split into two flat queries
  // and stitch in JS — far cheaper, and lets us avoid loading any column
  // we don't actually render in /admin.
  try {
    let clients: Awaited<ReturnType<typeof prisma.client.findMany>>;
    let connRows: Array<{
      id: string;
      clientId: string;
      platform: Platform;
      connectionStatus: ConnectionStatus;
      isMandatory: boolean;
      externalAccountUrl: string | null;
      externalAccountName: string | null;
      lastSyncAt: Date | null;
      lastSyncError: string | null;
    }>;

    try {
      const clientSelect = light
        ? {
            id: true,
            slug: true,
            name: true,
            timezone: true,
            status: true,
            clientType: true,
            campaignStartDate: true,
            reportingStartDate: true,
            internalOwner: true,
            website: true,
            archivedAt: true,
            archiveReason: true,
            logoUrl: true,
            industry: true,
            createdAt: true,
            updatedAt: true,
          }
        : undefined;
      [clients, connRows] = await Promise.all([
        prisma.client.findMany({
          where,
          orderBy: [{ status: "asc" }, { name: "asc" }],
          ...(clientSelect ? { select: clientSelect } : {}),
        }),
        prisma.platformConnection.findMany({
          where: { isEnabled: true },
          select: {
            id: true,
            clientId: true,
            platform: true,
            connectionStatus: true,
            isMandatory: true,
            externalAccountUrl: true,
            externalAccountName: true,
            lastSyncAt: true,
            lastSyncError: true,
          },
        }),
      ]);
    } catch (innerErr) {
      // Retry once on transient Prisma/edge-worker errors. Neon cold-starts
      // sometimes 500 the first call and succeed on the second within ~1s.
      await new Promise((r) => setTimeout(r, 400));
      [clients, connRows] = await Promise.all([
        prisma.client.findMany({
          where,
          orderBy: [{ status: "asc" }, { name: "asc" }],
          ...(light
            ? { select: {
                id: true, slug: true, name: true, timezone: true,
                status: true, clientType: true, campaignStartDate: true,
                reportingStartDate: true, internalOwner: true, website: true,
                archivedAt: true, archiveReason: true, logoUrl: true,
                industry: true, createdAt: true, updatedAt: true,
              } }
            : {}),
        }),
        prisma.platformConnection.findMany({
          where: { isEnabled: true },
          select: {
            id: true,
            clientId: true,
            platform: true,
            connectionStatus: true,
            isMandatory: true,
            externalAccountUrl: true,
            externalAccountName: true,
            lastSyncAt: true,
            lastSyncError: true,
          },
        }),
      ]);
    }

    const connsByClient = new Map<string, typeof connRows>();
    for (const c of connRows) {
      const arr = connsByClient.get(c.clientId) ?? [];
      arr.push(c);
      connsByClient.set(c.clientId, arr);
    }
    // Re-shape so each client has its connections inline (legacy API contract).
    const clientsWithConns = clients.map((c) => ({
      ...c,
      platformConnections: (connsByClient.get(c.id) ?? []).map((cc) => ({
        id: cc.id,
        platform: cc.platform,
        connectionStatus: cc.connectionStatus,
        isMandatory: cc.isMandatory,
        externalAccountUrl: cc.externalAccountUrl,
        externalAccountName: cc.externalAccountName,
        lastSyncAt: cc.lastSyncAt,
        lastSyncError: cc.lastSyncError,
      })),
    }));

    // Fetch latest post for each client's platform connections (only when not in light mode)
    const clientIds = clientsWithConns.map((c) => c.id);
    let latestPosts: Array<{
      clientId: string;
      platform: string;
      platformConnectionId: string;
      postTextSnippet: string | null;
      postUrl: string | null;
      publishedAtUtc: Date;
    }> = [];
    if (!light) {
      try {
        latestPosts = clientIds.length > 0
          ? await prisma.socialPost.findMany({
              where: { clientId: { in: clientIds } },
              orderBy: { publishedAtUtc: "desc" },
              // Cap the result so we don't blow worker CPU/memory when
              // there are thousands of historical posts. 500 is plenty —
              // we only keep one per (clientId, platform) key anyway.
              take: 500,
              select: {
                clientId: true,
                platform: true,
                platformConnectionId: true,
                postTextSnippet: true,
                postUrl: true,
                publishedAtUtc: true,
              },
            })
          : [];
      } catch {
        console.warn("GET /api/clients: socialPost query failed, continuing without latest posts");
      }
    }

    const latestPostMap = new Map();
    for (const post of latestPosts) {
      const key = post.clientId + ":" + post.platform;
      if (!latestPostMap.has(key)) {
        latestPostMap.set(key, post);
      }
    }

    const enriched = clientsWithConns.map((client) => ({
      ...client,
      platformConnections: client.platformConnections.map((conn) => {
        const latestPost = latestPostMap.get(client.id + ":" + conn.platform);
        return {
          ...conn,
          latestPost: latestPost
            ? {
                snippet: latestPost.postTextSnippet,
                url: latestPost.postUrl,
                publishedAt: latestPost.publishedAtUtc,
              }
            : null,
        };
      }),
    }));

    return NextResponse.json({ success: true, data: enriched }, {
      headers: light ? { "Cache-Control": "public, max-age=15, s-maxage=60" } : {},
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Database query failed";
    console.error("GET /api/clients error:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST /api/clients — create a company.
//
// Reliability contract (added v2.9.1 after Olivier reported "I get an error
// every time even though the company IS created"):
//
//   Once prisma.client.create() succeeds, this handler MUST return 201.
//   Every step after the insert is best-effort and can only degrade the
//   response payload — never turn it into an error. Previously an unguarded
//   throw in any post-insert step (connection insert, token propagation,
//   audit log, re-read with nested include) escaped the handler, so the edge
//   worker returned a raw non-JSON 500 while the row sat committed in Neon.
//   That is exactly the "error but it worked" symptom.
export async function POST(req: NextRequest) {
  // `warnings` collects non-fatal post-insert failures so the UI can show
  // "created, but X didn't run" instead of a bare error.
  const warnings: string[] = [];

  try {
    const body = await req.json().catch(() => null);
    const parsed = createClientSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Check slug uniqueness
    const existing = await prisma.client.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      return NextResponse.json({ success: false, error: "Slug already taken" }, { status: 409 });
    }

    const { platformConnections: connections, ...clientData } = parsed.data;

    // ---- The only step that is allowed to fail the request ----------------
    let client: Awaited<ReturnType<typeof prisma.client.create>>;
    try {
      client = await prisma.client.create({
        data: {
          ...clientData,
          campaignStartDate: clientData.campaignStartDate ? new Date(clientData.campaignStartDate) : null,
          reportingStartDate: clientData.reportingStartDate ? new Date(clientData.reportingStartDate) : null,
        },
      });
    } catch (createErr) {
      const m = createErr instanceof Error ? createErr.message : String(createErr);
      // Lost the race against a concurrent create with the same slug.
      if (m.includes("P2002") || m.toLowerCase().includes("unique constraint")) {
        return NextResponse.json(
          { success: false, error: "Slug already taken" },
          { status: 409 }
        );
      }
      console.error("POST /api/clients: client.create failed:", m);
      return NextResponse.json(
        { success: false, error: `Could not create company: ${m}` },
        { status: 500 }
      );
    }
    // ---- From here on, we are committed to returning 201 ------------------

    // Platform connections. Each insert is independent — one bad platform
    // string must not cost us the other connections or the whole response.
    if (connections && connections.length > 0) {
      for (const conn of connections) {
        try {
          await prisma.platformConnection.create({
            data: {
              clientId: client.id,
              platform: conn.platform as Platform,
              externalAccountUrl: conn.externalAccountUrl || null,
              connectionStatus: ConnectionStatus.PENDING,
              isMandatory: true,
              isEnabled: true,
            },
          });
        } catch (connErr) {
          const m = connErr instanceof Error ? connErr.message : String(connErr);
          console.error(`POST /api/clients: connection ${conn.platform} failed:`, m);
          warnings.push(`Could not add the ${conn.platform} connection — add it from the company page.`);
        }
      }

      // Olivier's UX rule: a brand-new company should NOT sit in PENDING just
      // because we already authorized that platform on a different company.
      // Copy any existing valid OAuth token from a sibling connection of the
      // same platform onto these freshly-created PENDING rows. Best-effort.
      try {
        await propagateTokensForAllPlatforms();
      } catch {
        // Non-fatal — the client + connections still exist either way.
        warnings.push("Platform connections were left PENDING — reconnect them from the company page.");
      }
    }

    // Audit log — nice to have, never worth failing a create over.
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: null,
          actionType: "CLIENT_CREATED",
          entityType: "Client",
          entityId: client.id,
          afterJson: JSON.stringify(client),
        },
      });
    } catch (auditErr) {
      console.error(
        "POST /api/clients: audit log failed:",
        auditErr instanceof Error ? auditErr.message : String(auditErr)
      );
    }

    // Re-read with connections. Nested `include` is the query shape that has
    // repeatedly blown edge-worker CPU on this project (see GET above), so if
    // it fails we stitch the response together from two flat queries, and if
    // THAT fails we return the freshly-created row on its own.
    let fullClient: unknown = null;
    try {
      fullClient = await prisma.client.findUnique({
        where: { id: client.id },
        include: { platformConnections: true },
      });
    } catch {
      try {
        const conns = await prisma.platformConnection.findMany({ where: { clientId: client.id } });
        fullClient = { ...client, platformConnections: conns };
      } catch {
        fullClient = { ...client, platformConnections: [] };
      }
    }
    if (!fullClient) fullClient = { ...client, platformConnections: [] };

    // NOTE: the Phantombuster spreadsheet re-sync used to be kicked off here as
    // an un-awaited self-fetch to /api/admin/sheets-sync. On the Cloudflare edge
    // runtime a pending fetch that outlives its request has no waitUntil() to
    // keep it alive — the runtime tears down the I/O context and can abort the
    // response body mid-flight, which surfaces in the browser as a failed
    // fetch on a create that actually succeeded. The browser now fires that
    // sync itself after a successful create (see admin/page-client.tsx).
    return NextResponse.json(
      { success: true, data: fullClient, warnings: warnings.length ? warnings : undefined },
      { status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unexpected error creating company";
    console.error("POST /api/clients unhandled error:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
