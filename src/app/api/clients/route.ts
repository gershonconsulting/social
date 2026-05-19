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

export async function POST(req: NextRequest) {
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

  const client = await prisma.client.create({
    data: {
      ...clientData,
      campaignStartDate: clientData.campaignStartDate ? new Date(clientData.campaignStartDate) : null,
      reportingStartDate: clientData.reportingStartDate ? new Date(clientData.reportingStartDate) : null,
    },
  });

  // Create platform connections if provided
  if (connections && connections.length > 0) {
    for (const conn of connections) {
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
    }

    // Olivier's UX rule: a brand-new company should NOT sit in PENDING just
    // because we already authorized that platform on a different company.
    // Copy any existing valid OAuth token from a sibling connection of the
    // same platform onto these freshly-created PENDING rows. Best-effort.
    try {
      await propagateTokensForAllPlatforms();
    } catch {
      // Non-fatal — the client + connections still exist either way.
    }
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      actionType: "CLIENT_CREATED",
      entityType: "Client",
      entityId: client.id,
      afterJson: JSON.stringify(client),
    },
  });

  // Return client with connections
  const fullClient = await prisma.client.findUnique({
    where: { id: client.id },
    include: { platformConnections: true },
  });

  // Fire-and-forget: keep the Phantombuster source spreadsheet in sync.
  // Doesn't block the response — if it fails the client is still created.
  void (async () => {
    try {
      const url = new URL(req.url);
      await fetch(`${url.protocol}//${url.host}/api/admin/sheets-sync`, { method: "POST" });
    } catch { /* swallow — non-fatal */ }
  })();

  return NextResponse.json({ success: true, data: fullClient }, { status: 201 });
}
