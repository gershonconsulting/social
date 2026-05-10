export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ClientStatus, ClientType, Platform, ConnectionStatus } from "@prisma/client";

/**
 * POST /api/admin/bulk-upsert-clients
 *
 * Single endpoint to reconcile a list of {name, slug, clientType, website,
 * connections: [{platform, externalAccountUrl}]} into the DB. Idempotent —
 * matching by slug (case-insensitive). Existing clients get updated
 * (category change, website fill-in). Connections get upserted by
 * (clientId, platform); URLs filled in or replaced.
 *
 * Used by Olivier to sync his master-list spreadsheet into Neon in one shot.
 *
 * Body:
 *   {
 *     companies: [
 *       { name, slug, clientType, website?, connections?: [{platform, externalAccountUrl}] }
 *     ]
 *   }
 */
type Incoming = {
  name: string;
  slug: string;
  clientType: string;
  website?: string | null;
  connections?: Array<{ platform: string; externalAccountUrl: string }>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { companies?: Incoming[] }
      | null;
    if (!body?.companies || !Array.isArray(body.companies)) {
      return NextResponse.json({ success: false, error: "companies[] required" }, { status: 400 });
    }

    const results: Array<{
      slug: string; name: string; clientId: string;
      created: boolean; connectionsUpserted: number;
    }> = [];

    for (const c of body.companies) {
      if (!c.name || !c.slug || !c.clientType) continue;
      const slug = c.slug.toLowerCase();
      const existing = await prisma.client.findUnique({ where: { slug } });
      let client;
      let created = false;
      if (existing) {
        client = await prisma.client.update({
          where: { id: existing.id },
          data: {
            name: c.name,
            clientType: c.clientType as ClientType,
            website: c.website ?? existing.website,
          },
        });
      } else {
        client = await prisma.client.create({
          data: {
            name: c.name,
            slug,
            timezone: "America/New_York",
            status: ClientStatus.ACTIVE,
            clientType: c.clientType as ClientType,
            website: c.website ?? null,
          },
        });
        created = true;
      }

      let connectionsUpserted = 0;
      for (const conn of c.connections ?? []) {
        if (!conn.platform || !conn.externalAccountUrl) continue;
        const platform = conn.platform as Platform;
        // Normalize URL: ensure https://, strip trailing slash
        let url = conn.externalAccountUrl.trim();
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        url = url.replace(/\/+$/, "");

        const existingConn = await prisma.platformConnection.findFirst({
          where: { clientId: client.id, platform },
        });
        if (existingConn) {
          await prisma.platformConnection.update({
            where: { id: existingConn.id },
            data: { externalAccountUrl: url, isEnabled: true },
          });
        } else {
          await prisma.platformConnection.create({
            data: {
              clientId: client.id,
              platform,
              externalAccountUrl: url,
              isEnabled: true,
              isMandatory: true,
              connectionStatus: ConnectionStatus.PENDING,
            },
          });
        }
        connectionsUpserted++;
      }

      results.push({ slug, name: client.name, clientId: client.id, created, connectionsUpserted });
    }

    return NextResponse.json({ success: true, data: { count: results.length, results } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bulk upsert failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
