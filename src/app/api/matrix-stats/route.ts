export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { ClientStatus, ClientType } from "@prisma/client";
import prisma from "@/lib/db";

/**
 * POST /api/matrix-stats — read-only feed for the weekly "Client Platform Matrix"
 * email (Supabase edge function). Same contract on all four Gershon apps.
 *
 * Request : {"secret":"…","people":[{"key":"…","company":"…","emails":["a@b.com"]}]}
 * Auth    : SHA-256 hex of `secret` must equal MATRIX_SECRET_SHA256 (only the hash is
 *           stored here). Mismatch → 401 {"ok":false}.
 * Response: {"ok":true,"platform":"social","results":[{"key","ok","note"}],"others":[…]}
 *
 * Social tracks client COMPANIES, so a person is matched to a Client of the primary
 * (Gershon Consulting) organization by company name (case-insensitive, legal suffixes
 * like AG/Intl/Inc ignored) or by email domain vs Client.website domain.
 * ok=true when the matched Client is ACTIVE and not archived.
 * note = "campaign" for CAMPAIGN clients, else "N posts (30d)"; "paused"/"archived"/…
 * when matched but not active; null when no match.
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

    const needCounts = Array.from(new Set(picks.filter((c) => c && c.status === ClientStatus.ACTIVE && c.clientType !== ClientType.CAMPAIGN).map((c) => c!.id)));
    const counts = new Map<string, number>();
    if (needCounts.length) {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const rows = await prisma.socialPost.groupBy({
        by: ["clientId"],
        where: { clientId: { in: needCounts }, publishedAtUtc: { gte: since } },
        _count: { _all: true },
      });
      for (const r of rows as { clientId: string; _count: { _all: number } }[]) counts.set(r.clientId, r._count._all);
    }

    const results = people.map((p, i) => {
      const key = String(p?.key ?? "");
      const c = picks[i];
      if (!c) return { key, ok: false, note: null };
      if (c.status !== ClientStatus.ACTIVE) return { key, ok: false, note: c.status.toLowerCase().replace(/_/g, " ").slice(0, 20) };
      if (c.clientType === ClientType.CAMPAIGN) return { key, ok: true, note: "campaign" };
      return { key, ok: true, note: `${counts.get(c.id) ?? 0} posts (30d)` };
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
