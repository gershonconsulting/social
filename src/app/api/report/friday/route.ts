export const runtime = "edge";
import { NextRequest, NextResponse } from "next/server";
import { primaryOrgId } from "@/lib/reports/monthly/data";
import { orgFromSession } from "@/lib/session-org";
import { listFridayClients } from "@/lib/reports/friday/data";
import { FRIDAY_KINDS, type FridayKind } from "@/lib/reports/friday/render";
import { buildFridayPack, sendFridayPack } from "@/lib/reports/friday/send";
import { bundlingOn } from "@/lib/reports/bundle/mode";
import { flushFridayPack, stageFridayClient } from "@/lib/reports/bundle/friday-pack";

/**
 * Friday client reports (v4.78.0) — three e-mails per campaign client / client:
 * Company, Competitive and Intelligence, for the last 7 full ET days.
 *
 * GET  ?list=1                         the clients that get the pack (JSON)
 * GET  ?client=<id>&kind=company|competitive|intelligence   preview one e-mail (never sends)
 *        &refresh=1                    re-run the AI instead of today's cached answer
 * POST ?client=<id>                    build AND send that client's three e-mails
 *        &force=1                      resend even if today's already went out
 *        &to=a@b.c                     send to another address (testing; not recorded)
 *
 * GET needs a signed-in user (their own workspace) or the cron Bearer (Gershon's);
 * POST needs Bearer CRON_SECRET | DIGEST_SECRET. Scheduled by friday-reports.yml.
 */
function bearerOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET;
  return !!secret && (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  try {
    const own = await orgFromSession().catch(() => null);
    const org = own || (bearerOk(req) ? await primaryOrgId() : null);
    if (!org) return NextResponse.json({ success: false, error: "Sign in to social.gershon.ai to preview this report." }, { status: 401 });
    if (url.searchParams.get("list") === "1") {
      const clients = await listFridayClients(org);
      return NextResponse.json({ success: true, data: clients.map((c) => ({ id: c.id, name: c.name, type: c.clientType })) });
    }
    const client = url.searchParams.get("client");
    const kind = (url.searchParams.get("kind") || "company") as FridayKind;
    if (!client || !FRIDAY_KINDS.includes(kind)) {
      return NextResponse.json({ success: false, error: `client and kind (${FRIDAY_KINDS.join(", ")}) are required` }, { status: 400 });
    }
    const { data, emails } = await buildFridayPack(org, client, { kinds: [kind], refresh: !!own && url.searchParams.get("refresh") === "1" });
    if (url.searchParams.get("format") === "json") return NextResponse.json({ success: true, data: { subject: emails[0].subject, report: data } });
    return new NextResponse(emails[0].html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "report build failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!bearerOk(req)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const client = url.searchParams.get("client");
  const force = url.searchParams.get("force") === "1";
  const to = url.searchParams.get("to") || undefined;
  // v4.82.0: ONE Friday pack email (every client, 3 report links each) instead of 3 per client.
  // Each ?client= call stages that client; the call that completes the list sends the pack.
  // ?flush=1 sends what is staged now; ?separate=1 or Setting report_bundling=off → the old 3 emails.
  const bundled = url.searchParams.get("separate") !== "1" && (await bundlingOn());
  if (bundled && url.searchParams.get("flush") === "1") {
    try {
      const r = await flushFridayPack({ force, to });
      return NextResponse.json({ success: r.sent || !!r.skipped, data: r }, { status: r.sent || r.skipped ? 200 : 502 });
    } catch (e) {
      return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "pack send failed" }, { status: 500 });
    }
  }
  if (!client) return NextResponse.json({ success: false, error: "client is required (GET ?list=1 for the list)" }, { status: 400 });
  if (bundled && !to) {
    try {
      const r = await stageFridayClient(await primaryOrgId(), client, { force });
      const ok = !r.error;
      return NextResponse.json({ success: ok, data: [r] }, { status: ok ? 200 : 502 });
    } catch (e) {
      return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "pack stage failed" }, { status: 500 });
    }
  }
  try {
    const results = await sendFridayPack(await primaryOrgId(), client, {
      force: url.searchParams.get("force") === "1",
      to: url.searchParams.get("to") || undefined,
    });
    const ok = results.every((r) => r.sent || r.skipped);
    return NextResponse.json({ success: ok, data: results }, { status: ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "report send failed" }, { status: 500 });
  }
}
