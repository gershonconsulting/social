export const runtime = "edge";
/**
 * /api/publishing/linked — Settings → Linked accounts (v4.60.0).
 *
 * GET  → { apps: {linkedin, x}, companies: [{ id, name, clientType, target, linkedin, x }] }
 * POST { clientId, net, action: "disconnect" } | { clientId, action: "author", urn }
 * PUT  { net, clientId, clientSecret? } — the developer-app keys (sealed in Setting).
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { getTarget, saveTarget, PUBLISHING_CLIENT_WHERE } from "@/lib/publishing";
import {
  appReady, getAppCreds, getLinked, liAuthorUrl, liMatches, redirectUri, saveAppCreds, saveLinked, xMatches, type LinkNet,
} from "@/lib/linked-accounts";

async function apps() {
  const out: Record<string, unknown> = {};
  for (const net of ["linkedin", "x"] as LinkNet[]) {
    const c = await getAppCreds(net);
    out[net] = { clientId: c.clientId, hasSecret: !!c.clientSecret, source: c.source, ready: appReady(net, c), redirectUri: redirectUri(net) };
  }
  return out;
}

export async function GET() {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  try {
    const clients = await prisma.client.findMany({
      where: { organizationId: c.orgId, archivedAt: null, status: { not: "ARCHIVED" }, ...PUBLISHING_CLIENT_WHERE },
      select: { id: true, name: true, clientType: true },
      orderBy: [{ clientType: "desc" }, { name: "asc" }],
    });
    const companies = [];
    for (const cl of clients) {
      const [l, t] = await Promise.all([getLinked(c.orgId, cl.id), getTarget(c.orgId, cl.id)]);
      companies.push({
        ...cl,
        target: { linkedinUrl: t.linkedinUrl, xHandle: t.xHandle },
        linkedin: l.linkedin
          ? {
              expiresAt: l.linkedin.expiresAt, refreshExpiresAt: l.linkedin.refreshExpiresAt, connectedBy: l.linkedin.connectedBy, connectedAt: l.linkedin.connectedAt,
              authors: l.linkedin.authors.map((a) => ({ urn: a.urn, name: a.name, kind: a.kind })), author: l.linkedin.author,
              lastError: l.linkedin.lastError, postsHere: liMatches(l.linkedin, t.linkedinUrl),
            }
          : null,
        x: l.x
          ? { username: l.x.username, name: l.x.name, expiresAt: l.x.expiresAt, connectedBy: l.x.connectedBy, connectedAt: l.x.connectedAt, lastError: l.x.lastError, postsHere: xMatches(l.x, t.xHandle) }
          : null,
      });
    }
    return NextResponse.json({ success: true, data: { apps: await apps(), companies, canWrite: c.canWrite } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = (await req.json().catch(() => null)) as { clientId?: string; net?: LinkNet; action?: string; urn?: string } | null;
  const cl = b?.clientId ? await prisma.client.findFirst({ where: { id: b.clientId, organizationId: c.orgId, ...PUBLISHING_CLIENT_WHERE }, select: { id: true } }) : null;
  if (!cl) return NextResponse.json({ success: false, error: "Unknown company." }, { status: 400 });
  const l = await getLinked(c.orgId, cl.id);
  if (b?.action === "disconnect" && (b.net === "linkedin" || b.net === "x")) {
    l[b.net] = null;
    await saveLinked(c.orgId, cl.id, l);
    return NextResponse.json({ success: true });
  }
  if (b?.action === "author" && l.linkedin) {
    const a = l.linkedin.authors.find((x) => x.urn === b.urn);
    if (!a) return NextResponse.json({ success: false, error: "That page isn't available on this connection." }, { status: 400 });
    l.linkedin.author = a.urn;
    await saveLinked(c.orgId, cl.id, l);
    // The company's main LinkedIn destination follows the chosen page (never replaces a group).
    const url = liAuthorUrl(a);
    const t = await getTarget(c.orgId, cl.id);
    if (url && (!t.linkedinUrl || !/\/groups\//.test(t.linkedinUrl))) await saveTarget(c.orgId, cl.id, { linkedinUrl: url });
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ success: false, error: "Bad request" }, { status: 400 });
}

export async function PUT(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = (await req.json().catch(() => null)) as { net?: LinkNet; clientId?: string; clientSecret?: string } | null;
  if (!b || (b.net !== "linkedin" && b.net !== "x") || !(b.clientId || "").trim()) {
    return NextResponse.json({ success: false, error: "Client ID required." }, { status: 400 });
  }
  await saveAppCreds(b.net, b.clientId!, b.clientSecret ?? null);
  return NextResponse.json({ success: true, data: { apps: await apps() } });
}
