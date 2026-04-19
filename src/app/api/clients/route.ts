export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType, ConnectionStatus, Platform } from "@prisma/client";
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

  try {
    const clients = await prisma.client.findMany({
      where,
      include: {
        platformConnections: {
          where: { isEnabled: true },
          select: {
            id: true,
            platform: true,
            connectionStatus: true,
            isMandatory: true,
            externalAccountUrl: true,
            externalAccountName: true,
            lastSyncAt: true,
            lastSyncError: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });

    // Fetch latest post for each client's platform connections
    const clientIds = clients.map((c) => c.id);
    let latestPosts: any[] = [];
    try {
      latestPosts = clientIds.length > 0
        ? await prisma.socialPost.findMany({
            where: { clientId: { in: clientIds } },
            orderBy: { publishedAtUtc: "desc" },
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

    const latestPostMap = new Map();
    for (const post of latestPosts) {
      const key = post.clientId + ":" + post.platform;
      if (!latestPostMap.has(key)) {
        latestPostMap.set(key, post);
      }
    }

    const enriched = clients.map((client) => ({
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

    return NextResponse.json({ success: true, data: enriched });
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

  return NextResponse.json({ success: true, data: fullClient }, { status: 201 });
}
