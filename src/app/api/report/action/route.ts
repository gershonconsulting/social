export const runtime = "edge";
/**
 * One-click "✓ Done" / "Dismiss" from the report emails (v4.70.0).
 *
 *   GET /api/report/action?o=<workspace>&a=<card>&s=done|dismissed&t=<signature>
 *
 * No sign-in: the signature (lib/actions/token.ts) proves the link came from
 * our email and only allows the one status change it names, on the one card.
 * Lives under /api/report/ so the middleware lets it through (machine path).
 * GET shows a confirm button (mail link scanners open every link); the button POSTs
 * the same signed URL, which makes the change. Answers with a small page.
 */
import { NextRequest, NextResponse } from "next/server";
import { updateCard, PILLAR_LABEL, type ActionStatus } from "@/lib/actions/store";
import { verifyAction } from "@/lib/actions/token";
import { esc, SITE } from "@/lib/reports/ops/shell";

function pageHtml(title: string, detail: string, ok: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f5f5f7;color:#1d1d1f;">
<div style="max-width:520px;margin:48px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
<div style="font-size:12px;font-weight:700;color:#FE1B04;letter-spacing:.04em;">SOCIAL · GERSHON.AI</div>
<div style="font-size:22px;font-weight:800;margin-top:8px;">${ok ? "✅" : "⚠️"} ${esc(title)}</div>
<div style="font-size:14px;color:#374151;margin-top:10px;line-height:1.5;">${detail}</div>
<a href="${SITE}/actions" style="display:inline-block;margin-top:20px;padding:10px 16px;border-radius:8px;background:#FE1B04;color:#fff;font-weight:700;text-decoration:none;">Open your actions</a>
</div></body></html>`;
}

async function handle(req: NextRequest) {
  const u = new URL(req.url);
  const orgId = u.searchParams.get("o") || "";
  const id = u.searchParams.get("a") || "";
  const s = u.searchParams.get("s");
  const t = u.searchParams.get("t") || "";
  const html = (title: string, detail: string, ok: boolean, status = 200) =>
    new NextResponse(pageHtml(title, detail, ok), { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

  if (!orgId || !id || (s !== "done" && s !== "dismissed")) return html("This link is incomplete", "Open the action from the report again.", false, 400);
  const status = s as ActionStatus;
  if (!(await verifyAction(orgId, id, status, t))) return html("This link is not valid", "It may have been changed. Open the action from the report again.", false, 403);
  // v4.70.0 review: email link scanners open every link, so GET only asks; the button POSTs.
  if (req.method === "GET") {
    const label = status === "done" ? "✓ Mark as done" : "Dismiss this action";
    return html(
      status === "done" ? "Mark this action as done?" : "Dismiss this action?",
      `<form method="post" action="${esc(u.pathname + u.search)}" style="margin:0;"><button type="submit" style="margin-top:6px;padding:10px 16px;border:0;border-radius:8px;background:${status === "done" ? "#047857" : "#6b7280"};color:#fff;font-weight:700;font-size:14px;cursor:pointer;">${label}</button></form>`,
      true,
    );
  }
  try {
    const c = await updateCard(orgId, id, { status });
    if (!c) return html("Action not found", "It is older than the actions Social keeps.", false, 404);
    return html(
      status === "done" ? "Marked as done" : "Dismissed",
      `<b>${esc(PILLAR_LABEL[c.pillar])} · ${esc(c.forCompany)}</b><br>${esc(c.action)}` +
        (status === "done" ? `<br><br>Next week's report will show this company's posts and engagement since today.` : ""),
      true,
    );
  } catch {
    return html("Could not save", "Please try again in a minute.", false, 500);
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
