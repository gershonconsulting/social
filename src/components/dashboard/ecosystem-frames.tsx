/**
 * v4.67.0 — Ecosystem frames on Social's dashboard (Olivier, 2026-10-27):
 * "for social we need to track for our clients (internal, clients, partners,
 * competitors, organizations)". One framed card per tracked company, grouped
 * by category, coloured by COLLECTION health:
 *
 *   ratio = networks collected recently / LinkedIn + X networks tracked
 *   a network counts as collected when its last sync is < 48 h old with no
 *   error, or a post published in the last 14 days was collected.
 *   No LinkedIn/X link at all = 0 (red: we are not tracking it).
 *
 * Green = every network up to date · Orange = 50–99% · Red = under 50%.
 * Workspace-scoped automatically (prisma from @/lib/db). Aggregated in the
 * database — no raw posts loaded into the edge worker.
 */
import prisma from "@/lib/db";
import { ClientFrames, type FrameItem } from "@/components/ui/client-frames";

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "INTERNAL", label: "Internal" },
  { key: "CAMPAIGN", label: "Campaign clients" },
  { key: "CLIENT", label: "Clients" },
  { key: "PARTNER", label: "Partners" },
  { key: "COMPETITION", label: "Competitors" },
  { key: "COMPANY", label: "Organizations" },
  { key: "PROSPECT", label: "Prospects" },
];
const SYNC_FRESH_MS = 48 * 3600 * 1000;
const POST_FRESH_MS = 14 * 86400 * 1000;
const NET = ["LINKEDIN", "TWITTER"] as const;

export async function EcosystemFrames() {
  const now = Date.now();
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE", clientType: { in: CATEGORIES.map((c) => c.key) as never } },
    select: { id: true, name: true, logoUrl: true, clientType: true },
    orderBy: { name: "asc" },
  });
  if (!clients.length) return null;
  const ids = clients.map((c) => c.id);
  const [conns, recent] = await Promise.all([
    prisma.platformConnection.findMany({
      where: { clientId: { in: ids }, isEnabled: true, platform: { in: [...NET] as never }, externalAccountUrl: { not: null } },
      select: { clientId: true, platform: true, lastSyncAt: true, lastSyncError: true },
    }),
    prisma.socialPost.groupBy({
      by: ["clientId", "platform"],
      where: { clientId: { in: ids }, publishedAtUtc: { gte: new Date(now - POST_FRESH_MS) } },
      _count: { _all: true },
    }),
  ]);
  const fresh = new Set(recent.map((r) => `${r.clientId}:${r.platform}`));
  const byClient = new Map<string, { linked: number; ok: number; notes: string[] }>();
  for (const c of conns) {
    const s = byClient.get(c.clientId) ?? { linked: 0, ok: 0, notes: [] };
    s.linked++;
    const synced = !!c.lastSyncAt && now - c.lastSyncAt.getTime() < SYNC_FRESH_MS && !c.lastSyncError;
    const ok = synced || fresh.has(`${c.clientId}:${c.platform}`);
    if (ok) s.ok++;
    else s.notes.push(`${c.platform === "LINKEDIN" ? "LinkedIn" : "X"} ${c.lastSyncError ? "error" : "stale"}`);
    byClient.set(c.clientId, s);
  }

  return (
    <div className="space-y-5 mt-5">
      {CATEGORIES.map((cat) => {
        const rows = clients.filter((c) => c.clientType === cat.key);
        if (!rows.length) return null;
        const items: FrameItem[] = rows.map((c) => {
          const s = byClient.get(c.id);
          return {
            id: c.id, name: c.name, logoUrl: c.logoUrl, href: `/clients/${c.id}`,
            ratio: s ? s.ok / s.linked : 0,
            detail: !s ? "no LinkedIn / X link — not tracked"
              : s.ok === s.linked ? `${s.linked} of ${s.linked} networks up to date`
              : `${s.ok} of ${s.linked} up to date · ${s.notes.join(", ")}`,
          };
        });
        return (
          <ClientFrames key={cat.key} title={`${cat.label} — collection`}
            subtitle="Green = every network collected recently · Orange = 50–99% · Red = under 50% or not tracked"
            items={items} />
        );
      })}
    </div>
  );
}
