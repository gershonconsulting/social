/**
 * Workspace seeding + mirrored companies.
 *
 * A new tenant often tracks companies the Gershon workspace already collects
 * (VALOS and its competitors, say). Rather than wait for that tenant to install
 * the extension and build history from zero, a company in their workspace can
 * MIRROR a source company: the source keeps being collected as usual, and its
 * posts are copied into the mirror on every sync. The mirror is an ordinary,
 * fully isolated Client row in the tenant's workspace — nothing is shared at
 * query time, so tenant scoping is untouched.
 *
 * Mirror link: OrgSetting in the TARGET workspace, key `mirror:<targetClientId>`,
 * value = source client id. Everything here uses the raw client and stamps
 * organizationId by hand, because it deliberately works across two workspaces.
 * Callers must have authorized that (platform admin, or a cron secret).
 */

import prisma from "@/lib/db-raw";
import { ClientStatus, ClientType, ConnectionStatus, Platform } from "@prisma/client";

const MIRROR_PREFIX = "mirror:";
const COLLECTED: Platform[] = [Platform.LINKEDIN, Platform.TWITTER];

export type SeedItem = { sourceClientId: string; clientType: ClientType };

/** Copy one company (row + LinkedIn/X connections) into a workspace and link it as a mirror. */
export async function mirrorClientInto(
  targetOrg: { id: string; slug: string },
  item: SeedItem
): Promise<{ sourceId: string; targetId: string; name: string }> {
  const src = await prisma.client.findUnique({
    where: { id: item.sourceClientId },
    include: { platformConnections: true },
  });
  if (!src) throw new Error(`Source company ${item.sourceClientId} not found`);

  // Already mirrored into this workspace? Re-use it (idempotent re-runs).
  const existingLinks = await prisma.orgSetting.findMany({
    where: { organizationId: targetOrg.id, key: { startsWith: MIRROR_PREFIX }, value: src.id },
  });
  for (const l of existingLinks) {
    const targetId = l.key.slice(MIRROR_PREFIX.length);
    const t = await prisma.client.findFirst({ where: { id: targetId, organizationId: targetOrg.id } });
    if (t) {
      if (t.clientType !== item.clientType) {
        await prisma.client.update({ where: { id: t.id }, data: { clientType: item.clientType } });
      }
      return { sourceId: src.id, targetId: t.id, name: t.name };
    }
  }

  // Client.slug is unique across ALL workspaces.
  let slug = `${src.slug}-${targetOrg.slug}`.slice(0, 100);
  for (let i = 2; await prisma.client.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${src.slug}-${targetOrg.slug}-${i}`.slice(0, 100);
    if (i > 30) throw new Error("Could not find a free slug");
  }

  const created = await prisma.client.create({
    data: {
      organizationId: targetOrg.id,
      name: src.name,
      slug,
      timezone: src.timezone,
      status: ClientStatus.ACTIVE,
      clientType: item.clientType,
      website: src.website,
      logoUrl: src.logoUrl,
      industry: src.industry,
      campaignStartDate: src.campaignStartDate,
      reportingStartDate: src.reportingStartDate,
      notes: "Mirrored from the Gershon workspace — posts are copied on every sync.",
    },
  });

  for (const c of src.platformConnections.filter((p) => COLLECTED.includes(p.platform))) {
    await prisma.platformConnection.create({
      data: {
        organizationId: targetOrg.id,
        clientId: created.id,
        platform: c.platform,
        externalAccountId: c.externalAccountId,
        externalAccountName: c.externalAccountName,
        externalAccountUrl: c.externalAccountUrl,
        isMandatory: c.isMandatory,
        isEnabled: true,
        connectionStatus: ConnectionStatus.CONNECTED,
        notes: "Mirrored connection",
      },
    });
  }

  await prisma.orgSetting.create({
    data: { organizationId: targetOrg.id, key: `${MIRROR_PREFIX}${created.id}`, value: src.id },
  });

  return { sourceId: src.id, targetId: created.id, name: created.name };
}

export type MirrorSyncResult = { mirrors: number; postsCopied: number; errors: string[] };

/**
 * Copy new posts from every source company into its mirrors.
 * `orgId` limits the pass to one workspace (used right after seeding).
 * Per mirror: posts published within the last `days` (first run) or since the
 * mirror's newest post minus a 7-day overlap; capped to keep inside the Worker budget.
 */
export async function syncMirrors(opts: { orgId?: string; days?: number; cap?: number } = {}): Promise<MirrorSyncResult> {
  const days = opts.days ?? 365;
  const cap = opts.cap ?? 400;
  const links = await prisma.orgSetting.findMany({
    where: { key: { startsWith: MIRROR_PREFIX }, ...(opts.orgId ? { organizationId: opts.orgId } : {}) },
  });
  const out: MirrorSyncResult = { mirrors: 0, postsCopied: 0, errors: [] };

  for (const link of links) {
    const targetId = link.key.slice(MIRROR_PREFIX.length);
    const sourceId = link.value;
    try {
      const target = await prisma.client.findFirst({
        where: { id: targetId, organizationId: link.organizationId },
        select: { id: true, organizationId: true },
      });
      if (!target) continue;
      out.mirrors++;

      const conns = await prisma.platformConnection.findMany({
        where: { clientId: target.id },
        select: { id: true, platform: true },
      });
      const connByPlatform = new Map(conns.map((c) => [c.platform, c.id]));

      const newest = await prisma.socialPost.findFirst({
        where: { clientId: target.id },
        orderBy: { publishedDateLocal: "desc" },
        select: { publishedDateLocal: true },
      });
      const since = newest
        ? new Date(new Date(newest.publishedDateLocal + "T00:00:00Z").getTime() - 7 * 86400_000)
        : new Date(Date.now() - days * 86400_000);

      const posts = await prisma.socialPost.findMany({
        where: { clientId: sourceId, publishedDateLocal: { gte: since.toISOString().slice(0, 10) } },
        orderBy: { publishedDateLocal: "desc" },
        take: cap,
      });

      const rows = [];
      for (const p of posts) {
        let connId = connByPlatform.get(p.platform);
        if (!connId) {
          // Source gained a platform after seeding — add it to the mirror.
          const c = await prisma.platformConnection.create({
            data: {
              organizationId: target.organizationId,
              clientId: target.id,
              platform: p.platform,
              connectionStatus: ConnectionStatus.CONNECTED,
              isMandatory: false,
              notes: "Mirrored connection",
            },
          });
          connId = c.id;
          connByPlatform.set(p.platform, connId);
        }
        rows.push({
          organizationId: target.organizationId,
          clientId: target.id,
          platformConnectionId: connId,
          platform: p.platform,
          externalPostId: p.externalPostId,
          postUrl: p.postUrl,
          postTextSnippet: p.postTextSnippet,
          postTextFull: p.postTextFull,
          hashtags: p.hashtags,
          hasMedia: p.hasMedia,
          publishedAtUtc: p.publishedAtUtc,
          publishedAtLocal: p.publishedAtLocal,
          publishedDateLocal: p.publishedDateLocal,
          likeCount: p.likeCount,
          commentCount: p.commentCount,
          shareCount: p.shareCount,
          viewCount: p.viewCount,
          importedAt: new Date(),
        });
      }
      if (rows.length) {
        const r = await prisma.socialPost.createMany({ data: rows, skipDuplicates: true });
        out.postsCopied += r.count;
      }
    } catch (e) {
      out.errors.push(`${targetId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
