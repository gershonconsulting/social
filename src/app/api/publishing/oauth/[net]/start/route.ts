export const runtime = "edge";
/**
 * GET /api/publishing/oauth/:net/start?clientId=… — sends the account owner to
 * LinkedIn's / X's own login + permission screen (v4.60.0).
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db-raw";
import { publishingCaller } from "@/lib/publishing-auth";
import { PUBLISHING_CLIENT_WHERE, SITE } from "@/lib/publishing";
import { appReady, getAppCreds, linkedinAuthorizeUrl, newState, xAuthorizeUrl, type LinkNet } from "@/lib/linked-accounts";

const back = (msg: string) => NextResponse.redirect(`${SITE}/settings?linked_error=${encodeURIComponent(msg)}#linked`);

export async function GET(req: NextRequest, ctx: { params: Promise<{ net: string }> }) {
  const c = await publishingCaller(true);
  if (c instanceof NextResponse) return back("Sign in to social.gershon.ai first.");
  const { net } = await ctx.params;
  if (net !== "linkedin" && net !== "x") return back("Unknown network.");
  const clientId = new URL(req.url).searchParams.get("clientId") || "";
  const cl = await prisma.client.findFirst({ where: { id: clientId, organizationId: c.orgId, ...PUBLISHING_CLIENT_WHERE }, select: { id: true } });
  if (!cl) return back("Unknown company.");
  const app = await getAppCreds(net as LinkNet);
  if (!appReady(net as LinkNet, app)) {
    return back(net === "linkedin" ? "The LinkedIn publishing app's Client Secret is not set yet (Publishing apps, below)." : "The X publishing app is not set yet (Publishing apps, below).");
  }
  const { state, challenge } = await newState(c.orgId, cl.id, net as LinkNet, c.name || null);
  return NextResponse.redirect(net === "linkedin" ? linkedinAuthorizeUrl(app.clientId!, state) : xAuthorizeUrl(app.clientId!, state, challenge!));
}
