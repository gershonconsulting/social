export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { ClientStatus, ClientType } from "@prisma/client";
import prisma from "@/lib/db";
import { gradeSocial, COVERAGE_DAYS } from "@/lib/matrix/social-grade";

/**
 * POST /api/matrix-stats — read-only feed for the weekly "Client Platform Matrix"
 * email (Supabase edge function). Same contract on all four Gershon apps.
 *
 * Request : {"secret":"…","people":[{"key":"…","company":"…","emails":["a@b.com"]}]}
 * Auth    : SHA-256 hex of `secret` must equal MATRIX_SECRET_SHA256 (only the hash is
 *           stored here). Mismatch → 401 {"ok":false}.
 * Response: {"ok":true,"platform":"social","results":[{"key","ok","warn","level","note","companies",…}],"others":[…]}
 *
 * Social tracks client COMPANIES, so a person is matched to a Client of the primary
 * (Gershon Consulting) organization by company name (case-insensitive, legal suffixes
 * like AG/Intl/Inc ignored) or by email domain vs Client.website domain.
 * v4.84.0 (2026-11-23, Olivier): graded on what Social is FOR — watching companies
 * and collecting their content continuously so intelligent reports can be built.
 * Companies watched for a client = competitors/partners linked to it in Gershon's
 * workspace (OrgSetting competitors:<clientId>) + every company in the client's own
 * workspace (found through the people's emails). See lib/matrix/social-grade.ts:
 *   red    (ok:false)           fewer than 10 companies
 *   orange (ok:true, warn:true) 10+ companies, collection not continuous
 *   green  (ok:true)            10+ companies, collected in 48h, half covered in 14 days
 * "paused"/"archived"/… when matched but not active; null when no match.
 * others = ACTIVE CAMPAIGN clients of the primary org not matched to any person.
 */
const MATRIX_SECRET_SHA256 = "7031a38bde30c34db677585e85f696f51d78cc417e40d38572d20ebeb1c77569";

const SUFFIXES = new Set([
  "ag", "intl", "international", "inc", "incorporated", "llc", "ltd", "limited", "gmbh",
  "sa", "sas", "sarl", "sl", "srl", "spa", "bv", "nv", "plc", "corp", "corporation", "co",
  "company", "group", "holding", "holdings", "na", "usa", "us", "the",
]);

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.de", "orange.fr", "free.fr", "wanadoo.fr", "laposte.net",
]);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nameTokens(name: string): string[] {
  const t = name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (t.length > 1 && SUFFIXES.has(t[t.length - 1])) t.pop();
  while (t.length > 1 && t[0] === "the") t.shift();
  return t;
}

function namesMatch(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const A = a.join(" ");
  const B = b.join(" ");
  if (A === B) return true;
  if (A.replace(/ /g, "") === B.replace(/ /g, "")) return true;
  // One name is a leading word-prefix of the other ("urban factory" vs "urban factory lg").
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.join("").length < 4) return false;
  return s.every((w, i) => l[i] === w);
}

function hostOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website.trim()}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function domainsMatch(emailDomain: string, siteHost: string): boolean {
  return emailDomain === siteHost || emailDomain.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${emailDomain}`);
}

type PersonIn = { key?: unknown; company?: unknown; emails?: unknown };

export async function POST(req: NextRequest) {
  let body: { secret?: unknown; people?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!secret || (await sha256Hex(secret)) !== MATRIX_SECRET_SHA256) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const people: PersonIn[] = Array.isArray(body.people) ? (body.people as PersonIn[]) : [];
    const primary = await prisma.organization.findFirst({ where: { isPrimary: true }, select: { id: true } });
    if (!primary) {
      return NextResponse.json({ ok: true, platform: "social", results: people.map((p) => ({ key: String(p?.key ?? ""), ok: false, note: null })), others: [] });
    }

    const clients = await prisma.client.findMany({
      where: { organizationId: primary.id, archivedAt: null, status: { not: ClientStatus.ARCHIVED } },
      select: { id: true, name: true, status: true, clientType: true, website: true },
    });
    const indexed = clients.map((c) => ({ ...c, tokens: nameTokens(c.name), host: hostOf(c.website) }));

    const matchedIds = new Set<string>();
    const picks: (typeof indexed[number] | null)[] = people.map((p) => {
      const company = typeof p?.company === "string" ? p.company : "";
      const emails = Array.isArray(p?.emails) ? p.emails.filter((e): e is string => typeof e === "string") : [];
      const domains = emails
        .map((e) => e.trim().toLowerCase().split("@")[1] || "")
        .filter((d) => d && !FREEMAIL.has(d));
      const ct = nameTokens(company);
      const hits = indexed.filter(
        (c) => namesMatch(ct, c.tokens) || (!!c.host && domains.some((d) => domainsMatch(d, c.host as string))),
      );
      if (!hits.length) return null;
      hits.forEach((h) => matchedIds.add(h.id));
      // Prefer an ACTIVE client, then a CAMPAIGN one.
      hits.sort((x, y) =>
        (Number(y.status === ClientStatus.ACTIVE) - Number(x.status === ClientStatus.ACTIVE)) ||
        (Number(y.clientType === ClientType.CAMPAIGN) - Number(x.clientType === ClientType.CAMPAIGN)));
      return hits[0];
    });

    // Companies watched per person: linked in Gershon's workspace + the client's own workspace.
    const pickedIds = Array.from(new Set(picks.filter(Boolean).map((c) => c!.id)));
    const linkRows = pickedIds.length
      ? await prisma.orgSetting.findMany({ where: { organizationId: primary.id, key: { in: pickedIds.map((id) => `competitors:${id}`) } }, select: { key: true, value: true } })
      : [];
    const linked = new Map<string, string[]>();
    for (const r of linkRows) {
      try {
        const v = JSON.parse(r.value);
        if (Array.isArray(v)) linked.set(r.key.slice("competitors:".length), v.filter((x): x is string => typeof x === "string"));
      } catch { /* ignore a bad row */ }
    }
    const allEmails = Array.from(new Set(people.flatMap((p) => (Array.isArray(p?.emails) ? p.emails : []).filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()))));
    const users = allEmails.length
      ? await prisma.user.findMany({ where: { email: { in: allEmails, mode: "insensitive" }, organizationId: { not: null } }, select: { email: true, organizationId: true } })
      : [];
    const orgByEmail = new Map(users.filter((u) => u.organizationId && u.organizationId !== primary.id).map((u) => [u.email.toLowerCase(), u.organizationId as string]));
    const wsOrgs = Array.from(new Set(orgByEmail.values()));
    const wsClients = wsOrgs.length
      ? await prisma.client.findMany({ where: { organizationId: { in: wsOrgs }, archivedAt: null, status: { not: ClientStatus.ARCHIVED }, clientType: { not: ClientType.INTERNAL } }, select: { id: true, organizationId: true, name: true } })
      : [];
    const byOrg = new Map<string, { id: string; tokens: string[] }[]>();
    for (const c of wsClients) byOrg.set(c.organizationId as string, [...(byOrg.get(c.organizationId as string) || []), { id: c.id, tokens: nameTokens(c.name) }]);

    const watched: string[][] = people.map((p, i) => {
      const ids = new Set<string>(picks[i] ? linked.get(picks[i]!.id) || [] : []);
      const emails = Array.isArray(p?.emails) ? p.emails.filter((e): e is string => typeof e === "string") : [];
      // The client's own company in its workspace is not a company it watches.
      const own = nameTokens(typeof p?.company === "string" ? p.company : "");
      for (const e of emails) {
        const o = orgByEmail.get(e.trim().toLowerCase());
        if (o) (byOrg.get(o) || []).forEach((w) => { if (!namesMatch(own, w.tokens)) ids.add(w.id); });
      }
      return Array.from(ids);
    });

    const allWatched = Array.from(new Set(watched.flat()));
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const sinceCov = new Date(Date.now() - COVERAGE_DAYS * 24 * 3600 * 1000);
    const stats = new Map<string, { last: Date | null; n30: number; cov: boolean }>();
    if (allWatched.length) {
      const [lastRows, recentRows] = await Promise.all([
        prisma.socialPost.groupBy({ by: ["clientId"], where: { clientId: { in: allWatched } }, _max: { importedAt: true } }),
        prisma.socialPost.groupBy({ by: ["clientId"], where: { clientId: { in: allWatched }, importedAt: { gte: since30 } }, _count: { _all: true }, _max: { importedAt: true } }),
      ]);
      for (const r of lastRows as { clientId: string; _max: { importedAt: Date | null } }[]) stats.set(r.clientId, { last: r._max.importedAt ? new Date(r._max.importedAt) : null, n30: 0, cov: false });
      for (const r of recentRows as { clientId: string; _count: { _all: number }; _max: { importedAt: Date | null } }[]) {
        const s = stats.get(r.clientId) || { last: null, n30: 0, cov: false };
        s.n30 = r._count._all;
        s.cov = !!r._max.importedAt && new Date(r._max.importedAt) >= sinceCov;
        stats.set(r.clientId, s);
      }
    }

    const results = people.map((p, i) => {
      const key = String(p?.key ?? "");
      const c = picks[i];
      const ids = watched[i];
      if (!c && !ids.length) return { key, ok: false, note: null };
      if (c && c.status !== ClientStatus.ACTIVE && !ids.length) return { key, ok: false, note: c.status.toLowerCase().replace(/_/g, " ").slice(0, 20) };
      let last: Date | null = null, posts30 = 0, covered = 0;
      for (const id of ids) {
        const s = stats.get(id);
        if (!s) continue;
        if (s.last && (!last || s.last > last)) last = s.last;
        posts30 += s.n30;
        if (s.cov) covered++;
      }
      const g = gradeSocial({ companies: ids.length, covered, posts30, lastCollectedAt: last });
      return { key, ok: g.ok, warn: g.warn, level: g.level, note: g.note, companies: ids.length, covered, posts30, last_collected_at: last ? last.toISOString() : null };
    });

    const others = indexed
      .filter((c) => c.status === ClientStatus.ACTIVE && c.clientType === ClientType.CAMPAIGN && !matchedIds.has(c.id))
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ ok: true, platform: "social", results, others }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
