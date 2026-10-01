/**
 * Monthly report — HTML email bodies. Table layout + inline CSS only (Gmail /
 * Outlook safe: no <style>, no SVG, no JS). Same content as the PDF, drawn
 * from the same model. Kept well under Gmail's 102 KB clipping limit.
 */
import type { CategoryModel, CompanyModel, MonthWindow, Tile } from "./model";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";
const F = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const K = { red: "#D92D20", ink: "#111317", mut: "#6B7280", rule: "#E4E2DC", tint: "#F5F4F0", good: "#067647", goodb: "#E7F3EC", li: "#0A66C2" };
const e = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const TK = (k: Tile["color"]) => ({ ink: K.ink, good: K.good, red: K.red })[k];

const shell = (inner: string, preheader: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${K.tint}">
<div style="display:none;max-height:0;overflow:hidden">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${K.tint};${F}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#fff;border:1px solid ${K.rule}">
${inner}
</table></td></tr></table></body></html>`;

const header = (sub: string, month: string, small: string) => `<tr><td style="background:#111317;padding:20px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="border-left:4px solid ${K.red};padding-left:12px;${F}">
<div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:.2px">SOCIAL <span style="font-size:11px;color:${K.red}">GERSHON.AI</span></div>
<div style="font-size:13px;color:#A8ABB2;margin-top:2px">${e(sub)}</div></td>
<td align="right" style="${F}"><div style="font-size:20px;font-weight:700;color:${K.red}">${e(month)}</div>
<div style="font-size:11px;color:#A8ABB2;margin-top:2px">${e(small)}</div></td></tr></table></td></tr>`;

const banner = (title: string, line: string) => `<tr><td style="padding:22px 28px 6px">
<div style="background:${K.tint};border-left:3px solid ${K.good};padding:14px 16px">
<div style="font-size:17px;font-weight:700;color:${K.ink}">${e(title)}</div>
<div style="font-size:13px;color:${K.ink};margin-top:4px;line-height:1.5">${e(line)}</div></div></td></tr>`;

const sect = (t: string) => `<tr><td style="padding:22px 28px 8px"><div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:${K.mut};border-bottom:1px solid ${K.rule};padding-bottom:6px">${e(t.toUpperCase())}</div></td></tr>`;

const tiles = (list: Tile[]) => `<tr><td style="padding:4px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${list.map((t) => `<td width="25%" valign="top" style="border:1px solid ${K.rule};border-top:3px solid ${TK(t.color)};padding:10px 12px">
<div style="font-size:10px;font-weight:700;letter-spacing:.6px;color:${K.mut}">${e(t.label)}</div>
<div style="font-size:24px;font-weight:700;color:${TK(t.color)};margin:4px 0 2px">${e(t.value)}</div>
<div style="font-size:11px;color:${K.mut};line-height:1.35">${e(t.sub)}</div></td>`).join("")}
</tr></table></td></tr>`;

function bars(dim: number, series: Array<{ vals: number[]; color: string }>, legend: Array<[string, string]>, h = 70) {
  const tot = Array.from({ length: dim }, (_, i) => series.reduce((s, q) => s + (q.vals[i] || 0), 0));
  const hi = Math.max(1, ...tot);
  const w = (100 / dim).toFixed(2);
  const cols = Array.from({ length: dim }, (_, i) => {
    const segs = series.slice().reverse().map((q) => {
      const px = Math.round((h * (q.vals[i] || 0)) / hi);
      return px ? `<div style="height:${px}px;background:${q.color}"></div>` : "";
    }).join("");
    return `<td valign="bottom" width="${w}%" style="padding:0 1px">${segs || `<div style="height:1px;background:${K.rule}"></div>`}</td>`;
  }).join("");
  const ticks = Array.from({ length: dim }, (_, i) => `<td align="center" style="font-size:9px;color:${K.mut}">${[1, 8, 15, 22, dim].includes(i + 1) ? i + 1 : ""}</td>`).join("");
  const leg = legend.map(([l, c]) => `<span style="display:inline-block;width:8px;height:8px;background:${c};margin:0 4px 0 12px"></span>${e(l)}`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${K.rule};padding:8px;table-layout:fixed">
<tr><td colspan="${dim}" style="font-size:10px;color:${K.mut};padding-bottom:6px" align="right">${leg}</td></tr>
<tr style="height:${h}px">${cols}</tr><tr>${ticks}</tr></table>`;
}
const good = (list: Array<[string, string]>) => `<tr><td style="padding:0 28px">${list.map((n) => `<div style="border-left:3px solid ${K.good};padding:2px 0 2px 12px;margin:10px 0">
<div style="font-size:13px;font-weight:700;color:${K.ink}">${e(n[0])}</div><div style="font-size:12px;color:${K.mut};margin-top:2px">${e(n[1])}</div></div>`).join("")}</td></tr>`;
const th = (t: string, align = "left") => `<td align="${align}" style="font-size:10px;font-weight:700;letter-spacing:.5px;color:${K.mut};padding:7px 6px;background:${K.tint}">${t}</td>`;
const td = (t: string | number, s = "", align = "left") => `<td align="${align}" style="font-size:12px;color:${K.ink};padding:7px 6px;border-top:1px solid ${K.rule};${s}">${t}</td>`;
const btn = (label: string, href: string) => `<a href="${href}" style="display:inline-block;background:${K.red};color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px">${e(label)}</a>`;
const footer = (left: string, right: string) => `<tr><td style="padding:24px 28px 22px"><div style="border-top:1px solid ${K.rule};padding-top:10px;font-size:11px;color:${K.mut}">${left}<span style="float:right">${e(right)}</span></div></td></tr>`;
const link = (t: { text: string; url: string | null }) => (t.url ? `<a href="${e(t.url)}" style="color:${K.ink};text-decoration:none">${e(t.text)}</a>` : e(t.text));

export function categorySubject(win: MonthWindow, m: CategoryModel): string {
  return `Social Report — ${m.label} — ${win.name} ${win.y} · ${fmt(m.totals.posts)} posts · ${fmt(m.totals.eng)} engagements`;
}

export function categoryHtml(win: MonthWindow, m: CategoryModel, build: string): string {
  return shell(`
${header(`${m.title} · ${m.sub}`, `${win.name.toUpperCase()} ${win.y}`, "monthly report")}
${banner(m.head, m.lead)}
${sect("The month at a glance")}${tiles(m.tiles)}
${sect(`${win.name} highlights`)}
<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${m.highlights.map((h) => `<td valign="top" width="${Math.floor(100 / m.highlights.length)}%" style="background:${K.goodb};border-left:3px solid ${K.good};padding:9px 11px">
<div style="font-size:10px;font-weight:700;color:${K.good};letter-spacing:.5px">${e(h[0])}</div>
<div style="font-size:14px;font-weight:700;color:${K.ink};margin:3px 0">${e(h[1])}</div><div style="font-size:11px;color:${K.mut}">${e(h[2])}</div></td>`).join("")}
</tr></table></td></tr>
${sect("Posts published per day")}
<tr><td style="padding:0 28px">${bars(win.dim, [{ vals: m.perDayLi, color: K.li }, { vals: m.perDay.map((v, i) => v - (m.perDayLi[i] || 0)), color: K.ink }], [["LinkedIn", K.li], ["X", K.ink]])}</td></tr>
${sect("Results per company")}
<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${th("COMPANY")}${th("POSTS", "right")}${th("DAYS", "right")}${th("ENGAGEMENT", "right")}${th("FOLLOWERS", "right")}${th("HIGHLIGHT")}</tr>
${m.rows.map((r) => `<tr>${td(`<b>${e(r.name)}</b>`)}${td(fmt(r.posts), "", "right")}${td(r.days, "", "right")}${td(`<b>${fmt(r.eng)}</b>`, "", "right")}${td(r.fol ? `+${fmt(r.fol)}` : "", `font-weight:700;color:${K.good}`, "right")}${td(e(r.note), `color:${K.good};font-size:11px`)}</tr>`).join("")}
</table></td></tr>
${m.top.length ? `${sect(`Best posts of ${win.name}`)}
<tr><td style="padding:0 28px">${m.top.map((t, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:7px 0"><tr>
<td valign="top" style="font-size:17px;font-weight:700;color:${K.red};width:24px">${i + 1}</td>
<td><div style="font-size:13px;font-weight:700;color:${K.ink}">${link(t)}</div><div style="font-size:11px;color:${K.mut};margin-top:1px">${e(t.company)} · ${e(t.net)} · ${e(t.date)}</div></td>
<td align="right" valign="top" style="font-size:12px;font-weight:700;color:${K.good};white-space:nowrap">${fmt(t.eng)} engagements</td></tr></table>`).join("")}</td></tr>` : ""}
${m.delivered && m.delivered.length ? `<tr><td style="padding:10px 28px 0;font-size:12px;color:${K.mut}">Each company's own one-page report was also sent to ${e(m.delivered.join(", "))}.</td></tr>` : ""}
<tr><td style="padding:16px 28px 0">${btn("Open the dashboard", `${APP}/dashboard`)}</td></tr>
${footer(`Social · Gershon.AI · ${e(m.label)} · The same report is attached as a one-page PDF.`, build)}
`, m.lead);
}

export function companySubject(win: MonthWindow, m: CompanyModel): string {
  return `Your ${win.name} on social — ${m.name} · ${m.tiles[0].value} posts · ${m.tiles[1].value} engagements`;
}

export function companyHtml(win: MonthWindow, m: CompanyModel, build: string, to: string): string {
  const first = m.toName ? m.toName.split(" ")[0] : null;
  return shell(`
${header(`Monthly report · ${m.name}`, `${win.name.toUpperCase()} ${win.y}`, m.toName ? `Prepared for ${m.toName}` : m.name)}
<tr><td style="padding:20px 28px 0;font-size:14px;color:${K.ink};line-height:1.5">${first ? `Hi ${e(first)}, here` : "Here"} are ${e(m.name)}'s highlights on LinkedIn and X for ${win.name}. The same report is attached as a one-page PDF to share with your team.</td></tr>
${banner(m.head, m.lead)}
${sect("Your headline numbers")}${tiles(m.tiles)}
${sect("Posts per day")}
<tr><td style="padding:0 28px">${bars(win.dim, [{ vals: m.perDay, color: K.red }], [["LinkedIn + X", K.red]])}</td></tr>
${m.themes.length ? `${sect("What you posted about")}
<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${m.themes.map(([t, v]) => `<tr><td style="font-size:12px;font-weight:700;color:${K.ink};padding:4px 10px 4px 0;width:170px">${e(t)}</td>
<td><div style="width:${Math.round((100 * v) / m.themes[0][1])}%;height:8px;background:${K.li}"></div></td><td align="right" style="font-size:12px;color:${K.mut};width:60px">${v} post${v === 1 ? "" : "s"}</td></tr>`).join("")}
</table></td></tr>` : ""}
${sect("Your best posts")}
<tr><td style="padding:0 28px">${m.top.map((t, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0"><tr>
<td valign="top" style="font-size:20px;font-weight:700;color:${K.red};width:26px">${i + 1}</td>
<td><div style="font-size:13px;font-weight:700;color:${K.ink}">${link(t)}</div><div style="font-size:11px;color:${K.good};margin-top:2px;font-weight:700">${fmt(t.likes)} likes · ${fmt(t.comments)} comments · ${fmt(t.shares)} shares <span style="color:${K.mut};font-weight:400">· ${e(t.date)} · ${e(t.net)}</span></div></td></tr></table>`).join("")}</td></tr>
${sect("Your momentum")}${good(m.momentum)}
${m.ideas.length ? `${sect(`Ideas for ${win.nextName}`)}${good(m.ideas)}` : ""}
${footer(`Sent to ${e(to)} · Social · Gershon.AI · measured daily from your public LinkedIn and X pages.`, build)}
`, m.lead);
}
