export const runtime = 'edge';
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildMonthly, renderCategory, renderCompany, runMonthlyReports } from "@/lib/reports/monthly/send";
import { primaryOrgId } from "@/lib/reports/monthly/data";

/**
 * Monthly reports — one per client category + each campaign company's own.
 * Always one page, positives only (see lib/reports/monthly/model.ts).
 *
 * GET  /api/report/monthly                              — index of this month's reports (preview links)
 * GET  /api/report/monthly?category=CAMPAIGN[&format=pdf|json]
 * GET  /api/report/monthly?company=<clientId>[&format=pdf]
 *        &month=YYYY-MM                                  — any closed month (default: last one)
 *      Auth: an ADMIN of the primary workspace, or Bearer CRON_SECRET / DIGEST_SECRET.
 * POST /api/report/monthly[?month=&force=1&dry=1]       — build AND send (same auth as GET: a primary-
 *      workspace ADMIN — so a month can be previewed then sent from the browser — or the Bearer secret)
 *
 * Production trigger: the daily digest calls runMonthlyReports() during the
 * first 7 days of each month; delivery is idempotent per report, so it sends
 * each one exactly once.
 */

function secretOk(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET;
  return !!secret && (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}
async function adminOk() {
  const s = await getSession();
  if (!s?.user || s.user.role !== "ADMIN") return false;
  return s.user.organizationId === (await primaryOrgId());
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function GET(req: NextRequest) {
  if (!secretOk(req) && !(await adminOk())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const month = url.searchParams.get("month");
    const format = url.searchParams.get("format") || "html";
    const catKey = url.searchParams.get("category");
    const companyId = url.searchParams.get("company");
    const b = await buildMonthly(month);

    if (catKey) {
      const m = b.categories.find((c) => c.key === catKey.toUpperCase());
      if (!m) return NextResponse.json({ error: `No ${catKey} report for ${b.win.key} — no company in that category published.` }, { status: 404 });
      if (format === "json") return NextResponse.json({ success: true, data: m });
      const r = renderCategory(b, m);
      if (format === "pdf") return new NextResponse(r.pdf.bytes() as unknown as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.filename}"` } });
      return new NextResponse(r.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (companyId) {
      const c = b.companies.find((x) => x.model.id === companyId);
      if (!c) return NextResponse.json({ error: "No report for that company this month." }, { status: 404 });
      if (format === "json") return NextResponse.json({ success: true, data: { ...c } });
      const r = renderCompany(b, c.model, c.recipients.join(", ") || "(no report email on file)");
      if (format === "pdf") return new NextResponse(r.pdf.bytes() as unknown as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.filename}"` } });
      return new NextResponse(r.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const q = (extra: string) => `?${extra}${month ? `&month=${encodeURIComponent(month)}` : ""}`;
    const rows = [
      ...b.categories.map((m) => `<tr><td><b>${esc(m.label)}</b></td><td>${m.totals.companies} companies · ${m.totals.posts} posts</td><td>report@${m.key === "CAMPAIGN" ? " + sales@" : ""}</td><td><a href="${q(`category=${m.key}`)}">email</a> · <a href="${q(`category=${m.key}&format=pdf`)}">PDF</a></td></tr>`),
      ...b.companies.map((c) => `<tr><td>&nbsp;&nbsp;↳ ${esc(c.model.name)}</td><td>campaign company report</td><td>${esc(c.recipients.join(", ") || "no report email on file")}</td><td><a href="${q(`company=${c.model.id}`)}">email</a> · <a href="${q(`company=${c.model.id}&format=pdf`)}">PDF</a></td></tr>`),
    ].join("");
    const html = `<!doctype html><meta charset="utf-8"><title>Monthly reports ${b.win.key}</title>
<body style="font:14px -apple-system,Segoe UI,Arial;margin:32px;color:#111317"><h2>Monthly reports — ${esc(b.win.name)} ${b.win.y}</h2>
<p style="color:#6B7280">One page each, positives only. Sent automatically in the first days of each month.</p>
<table cellpadding="8" style="border-collapse:collapse">${rows || "<tr><td>No category published anything this month.</td></tr>"}</table></body>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "build failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!secretOk(req) && !(await adminOk())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(req.url);
    const r = await runMonthlyReports({
      month: url.searchParams.get("month"),
      force: url.searchParams.get("force") === "1",
      dry: url.searchParams.get("dry") === "1",
    });
    return NextResponse.json({ success: true, data: r });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
