export const runtime = "edge";
/**
 * /api/publishing/accounts — where each client's posts go, and who reviews them.
 * (v4.37.0)
 *
 * GET  → clients with { xHandle, linkedinUrl, reviewerName, reviewerEmail, reviewUrl, pending }
 * PUT  { clientId, xHandle?, linkedinUrl?, reviewerName?, reviewerEmail? }
 * POST { clientId, action: "rotate_link" } — new review link; the old one stops working.
 * v4.42.0: PUT also takes { route: "workspace" | "client" } — publish through
 * Gershon's browser or the client's own Chrome extension. POST action
 * "rotate_key" replaces the client's publishing key (their extension stops).
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import {
  connectUrl, getPublisherState, getRoute, getTarget, liveStatus, publishKey, reviewToken, reviewUrl, saveTarget, setRoute, PUBLISHING_CLIENT_WHERE,
  InvalidReviewerEmailError, destinationsOf,
} from "@/lib/publishing";
import { isOnline, listBrowsers, targetStatus, type PublishBrowser } from "@/lib/publish-browsers";

async function row(orgId: string, cl: { id: string; name: string; clientType: string }, browsers?: PublishBrowser[]) {
  const [t, token, pending] = await Promise.all([
    getTarget(orgId, cl.id),
    reviewToken(orgId, cl.id),
    prisma.contentItem.count({ where: { organizationId: orgId, clientId: cl.id, status: { in: ["IN_REVIEW", "CHANGES_REQUESTED"] } } }),
  ]);
  const route = await getRoute(orgId, cl.id);
  const client =
    route === "client"
      ? await (async () => {
          const st = await getPublisherState(orgId, cl.id);
          return { connectUrl: connectUrl(await publishKey(orgId, cl.id)), live: liveStatus(st), lastSeenAt: st.lastSeenAt, version: st.version };
        })()
      : null;
  // v4.63.0: for each place this company posts to, can a Chrome publish there right now?
  const all = browsers ?? (await listBrowsers(orgId));
  const connections = route === "client" ? [] : destinationsOf(t).map((d) => targetStatus(all, d.network, d.target));
  return { ...cl, ...t, reviewUrl: reviewUrl(token), pending, route, client, connections };
}

function browserView(b: PublishBrowser) {
  return {
    id: b.id, label: b.label, version: b.version, lastSeenAt: b.lastSeenAt, online: isOnline(b),
    x: b.x.signedIn ? b.x.accounts : [], xSignedIn: b.x.signedIn, linkedinSignedIn: b.linkedin.signedIn, linkedinName: b.linkedin.name,
    linkedinPages: Object.entries(b.li).filter(([, v]) => v.ok).map(([k]) => k),
    lastPostAt: b.lastPostAt || null, lastError: b.lastError || null,
  };
}

export async function GET() {
  const c = await publishingCaller(false);
  if (c instanceof NextResponse) return c;
  try {
    const clients = await prisma.client.findMany({
      where: { organizationId: c.orgId, archivedAt: null, status: { not: "ARCHIVED" }, ...PUBLISHING_CLIENT_WHERE },
      select: { id: true, name: true, clientType: true },
      orderBy: [{ clientType: "asc" }, { name: "asc" }],
    });
    const browsers = await listBrowsers(c.orgId);
    const rows = [];
    for (const cl of clients) rows.push(await row(c.orgId, cl, browsers));
    return NextResponse.json({ success: true, data: { accounts: rows, canWrite: c.canWrite, browsers: browsers.map(browserView) } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

async function clientOf(orgId: string, id: unknown) {
  if (typeof id !== "string") return null;
  return prisma.client.findFirst({ where: { id, organizationId: orgId, ...PUBLISHING_CLIENT_WHERE }, select: { id: true, name: true, clientType: true } });
}

export async function PUT(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, string | null | undefined> & { destinations?: unknown; xKind?: string };
  const cl = await clientOf(c.orgId, b.clientId);
  if (!cl) return NextResponse.json({ success: false, error: "Unknown client." }, { status: 400 });
  // v4.59.0 audit: save the target first (it validates the reviewer email) so a
  // rejected request changes nothing; an invalid email is a 400, not a silent null.
  try {
    await saveTarget(c.orgId, cl.id, {
      xHandle: b.xHandle, linkedinUrl: b.linkedinUrl, reviewerName: b.reviewerName, reviewerEmail: b.reviewerEmail,
      xKind: b.xKind === undefined ? undefined : b.xKind === "personal" ? "personal" : "company",
      destinations: b.destinations === undefined ? undefined : (b.destinations as never),
    });
  } catch (e) {
    if (e instanceof InvalidReviewerEmailError) return NextResponse.json({ success: false, error: "Invalid reviewer email" }, { status: 400 });
    throw e;
  }
  if (b.route === "client" || b.route === "workspace") await setRoute(c.orgId, cl.id, b.route);
  return NextResponse.json({ success: true, data: await row(c.orgId, cl) });
}

export async function POST(req: NextRequest) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return c;
  const b = ((await req.json().catch(() => null)) || {}) as Record<string, string>;
  const cl = await clientOf(c.orgId, b.clientId);
  if (!cl) return NextResponse.json({ success: false, error: "Unknown client." }, { status: 400 });
  if (b.action === "rotate_key") {
    await publishKey(c.orgId, cl.id, true);
    return NextResponse.json({ success: true, data: await row(c.orgId, cl) });
  }
  if (b.action !== "rotate_link") return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  await reviewToken(c.orgId, cl.id, true);
  return NextResponse.json({ success: true, data: await row(c.orgId, cl) });
}
