/**
 * Monthly report — one-page PDF renderers. Same page grammar as the Linalysis
 * monthly PDF (head, section rules, tiles, day-axis bars, footer), in the
 * Social v4.9 palette. Every string is clipped to its box, so real data can
 * never push the page past one sheet.
 */
import { MrPdf, strWidth as W, type RGB } from "./pdf-writer";
import type { CategoryModel, CompanyModel, MonthWindow, Tile } from "./model";

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const C = {
  RED: hex("#D92D20"), INK: hex("#111317"), MUT: hex("#6B7280"), RULE: hex("#E4E2DC"), TINT: hex("#F5F4F0"),
  GOOD: hex("#067647"), GOODB: hex("#E7F3EC"), WHITE: [1, 1, 1] as RGB, LI: hex("#0A66C2"), X: hex("#111317"),
};
const PW = 612, PH = 792, M = 40, CW = PW - 2 * M;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const TC = (k: Tile["color"]) => ({ ink: C.INK, good: C.GOOD, red: C.RED })[k];

function clip(s: string, size: number, bold: boolean, max: number): string {
  s = String(s ?? "");
  if (W(s, bold, size) <= max) return s;
  while (s.length && W(s + "…", bold, size) > max) s = s.slice(0, -1);
  return s + "…";
}
function head(p: MrPdf, sub: string, right: string, small: string) {
  const y = PH - M;
  p.rect(M, y - 4, 4, 34, C.RED);
  p.text(M + 14, y + 16, "SOCIAL", 17, true, C.INK);
  p.text(M + 14 + W("SOCIAL", true, 17) + 5, y + 16, "GERSHON.AI", 9, true, C.RED);
  p.text(M + 14, y + 3, clip(sub, 9.5, false, 300), 9.5, false, C.MUT);
  p.rtext(PW - M, y + 16, right, 17, true, C.RED);
  p.rtext(PW - M, y + 4, clip(small, 7.5, false, 220), 7.5, false, C.MUT);
  p.line(M, y - 20, PW - M, C.INK, 1.2);
  return y - 20;
}
function sect(p: MrPdf, y: number, label: string, x0 = M, x1 = PW - M) {
  const L = label.toUpperCase();
  p.text(x0, y, L, 7.5, true, C.MUT);
  p.line(x0 + W(L, true, 7.5) + 8, y + 2.5, x1, C.RULE, 0.5);
}
function foot(p: MrPdf, left: string, right: string) {
  const fy = M - 8;
  p.line(M, fy + 14, PW - M, C.RULE, 0.5);
  p.text(M, fy + 4, clip(left, 6.6, false, 360), 6.6, false, C.MUT);
  p.rtext(PW - M, fy + 4, right, 6.6, false, C.MUT);
}
function box(p: MrPdf, x: number, y: number, w: number, h: number) {
  p.rect(x, y, w, h, C.WHITE);
  p.line(x, y, x + w, C.RULE, 0.5); p.line(x, y + h, x + w, C.RULE, 0.5);
  p.rect(x, y, 0.5, h, C.RULE); p.rect(x + w - 0.5, y, 0.5, h, C.RULE);
}
function banner(p: MrPdf, y: number, title: string, line: string) {
  p.rect(M, y, CW, 40, C.TINT); p.rect(M, y, 3, 40, C.GOOD);
  p.text(M + 14, y + 24, clip(title, 12, true, CW - 24), 12, true, C.INK);
  p.text(M + 14, y + 10, clip(line, 8.4, false, CW - 24), 8.4, false, C.INK);
}
function tiles(p: MrPdf, y: number, list: Tile[], h = 58) {
  const tw = (CW - 3 * 9) / 4;
  list.forEach((t, i) => {
    const x = M + i * (tw + 9), col = TC(t.color);
    box(p, x, y, tw, h); p.rect(x, y + h - 3, tw, 3, col);
    p.text(x + 10, y + h - 17, t.label, 6.4, true, C.MUT);
    p.text(x + 10, y + h - 38, clip(t.value, 20, true, tw - 16), 20, true, col);
    p.text(x + 10, y + 8, clip(t.sub, 6.6, false, tw - 16), 6.6, false, C.MUT);
  });
}
function niceTop(max: number) {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  for (const s of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (max <= s * mag) return s * mag;
  return 10 * mag;
}
function chart(p: MrPdf, x: number, y: number, w: number, h: number, dim: number,
  series: Array<{ vals: number[]; color: RGB }>, caption: string, legend: Array<[string, RGB]>) {
  box(p, x, y, w, h);
  const ax = x + 26, aw = w - 34, base = y + 11, plot = h - 25;
  const tot = Array.from({ length: dim }, (_, i) => series.reduce((s, q) => s + (q.vals[i] || 0), 0));
  const hi = niceTop(Math.max(1, ...tot));
  for (const f of [0, 0.5, 1]) {
    const gy = base + plot * f;
    p.line(ax, gy, x + w - 6, C.RULE, 0.4);
    const v = hi * f;
    p.rtext(ax - 4, gy - 2.4, Number.isInteger(v) ? String(v) : v.toFixed(1), 5.6, false, C.MUT);
  }
  const pw = aw / dim;
  for (let d = 1; d <= dim; d++) {
    const bx = ax + (d - 1) * pw + 0.5, bw = Math.max(1.6, pw - 1.4);
    let acc = 0;
    for (const q of series) {
      const v = q.vals[d - 1] || 0;
      if (!v) continue;
      const bh = (plot * v) / hi;
      p.rect(bx, base + acc, bw, bh, q.color); acc += bh;
    }
  }
  for (const d of [1, 8, 15, 22, dim]) p.ctext(ax + (d - 0.5) * pw, y + 3.5, String(d), 5.6, false, C.MUT);
  p.text(ax, y + h - 9, caption, 6.2, false, C.MUT);
  let lx = x + w - 8;
  for (const [label, col] of legend.slice().reverse()) {
    lx -= W(label, false, 6.2); p.text(lx, y + h - 9, label, 6.2, false, C.MUT);
    lx -= 9; p.rect(lx, y + h - 9, 6, 6, col); lx -= 8;
  }
}
function goodNotes(p: MrPdf, y: number, list: Array<[string, string]>, gap = 25) {
  for (const n of list) {
    p.rect(M, y - 2, 3, 20, C.GOOD);
    p.text(M + 12, y + 10, clip(n[0], 8.6, true, CW - 14), 8.6, true, C.INK);
    p.text(M + 12, y + 1, clip(n[1], 7.3, false, CW - 14), 7.3, false, C.MUT);
    y -= gap;
  }
  return y;
}

export function categoryPdf(win: MonthWindow, m: CategoryModel, build: string): MrPdf {
  const p = new MrPdf(PW, PH);
  let y = head(p, `${m.title}  ·  ${m.sub}`, win.label, "Social · Gershon.AI monthly report");
  y -= 50; banner(p, y, m.head, m.lead);
  y -= 14; sect(p, y, "The month at a glance"); y -= 66; tiles(p, y, m.tiles);

  y -= 22; sect(p, y, `${win.name} highlights`); y -= 46;
  const n = m.highlights.length, hw = (CW - (n - 1) * 9) / n;
  m.highlights.forEach((h, i) => {
    const x = M + i * (hw + 9);
    p.rect(x, y, hw, 38, C.GOODB); p.rect(x, y, 3, 38, C.GOOD);
    p.text(x + 11, y + 26, clip(h[0], 6.2, true, hw - 16), 6.2, true, C.GOOD);
    p.text(x + 11, y + 14, clip(h[1], 10.5, true, hw - 16), 10.5, true, C.INK);
    p.text(x + 11, y + 5, clip(h[2], 6.8, false, hw - 16), 6.8, false, C.MUT);
  });

  y -= 22; sect(p, y, "Posts published per day"); y -= 78;
  chart(p, M, y, CW, 72, win.dim,
    [{ vals: m.perDayLi, color: C.LI }, { vals: m.perDay.map((v, i) => v - (m.perDayLi[i] || 0)), color: C.X }],
    `${win.name} 1-${win.dim}`, [["LinkedIn", C.LI], ["X", C.X]]);

  y -= 22; sect(p, y, "Results per company"); y -= 16;
  const cx = [M + 2, M + 170, M + 214, M + 270, M + 318, M + 370, M + 384];
  p.rect(M, y - 5, CW, 15, C.TINT);
  ([["COMPANY", 0, 0], ["POSTS", 1, 1], ["DAYS", 2, 1], ["ENGAGEMENT", 3, 1], ["PER POST", 4, 1], ["FOLLOWERS", 5, 1], ["HIGHLIGHT", 6, 0]] as Array<[string, number, number]>)
    .forEach(([t, i, r]) => (r ? p.rtext(cx[i], y, t, 6.4, true, C.MUT) : p.text(cx[i], y, t, 6.4, true, C.MUT)));
  y -= 4;
  const shown = m.rows.slice(0, 8);
  for (const r of shown) {
    y -= 17; p.line(M, y + 13, PW - M, C.RULE, 0.4);
    p.text(cx[0], y + 1, clip(r.name, 8, true, 128), 8, true, C.INK);
    p.rtext(cx[1], y + 1, fmt(r.posts), 7.8, false, C.INK);
    p.rtext(cx[2], y + 1, String(r.days), 7.8, false, C.INK);
    p.rtext(cx[3], y + 1, fmt(r.eng), 7.8, true, C.INK);
    p.rtext(cx[4], y + 1, String(r.perPost), 7.8, false, C.INK);
    p.rtext(cx[5], y + 1, r.fol ? `+${fmt(r.fol)}` : "", 7.8, true, C.GOOD);
    p.text(cx[6], y + 1, clip(r.note, 7.2, false, PW - M - cx[6]), 7.2, false, C.GOOD);
  }
  if (m.rows.length > shown.length) {
    y -= 12;
    p.text(M + 2, y, `+ ${m.rows.length - shown.length} more companies published — full list in the dashboard.`, 6.8, false, C.MUT);
  }

  if (m.top.length) {
    y -= 24; sect(p, y, `Best posts of ${win.name}`); y -= 6;
    m.top.slice(0, 5).forEach((t, i) => {
      y -= 17;
      p.text(M, y, String(i + 1), 10, true, C.RED);
      p.text(M + 14, y + 1, clip(t.text, 8, true, 290), 8, true, C.INK);
      p.text(M + 312, y + 1, clip(`${t.company}  ·  ${t.net}  ·  ${t.date}`, 7, false, 140), 7, false, C.MUT);
      p.rtext(PW - M, y + 1, `${fmt(t.eng)} engagements`, 7.4, true, C.GOOD);
    });
  }
  if (m.delivered && m.delivered.length) {
    y -= 22;
    p.text(M, y, clip(`Each company's own one-page report was also sent to ${m.delivered.join(", ")}.`, 7, false, CW), 7, false, C.MUT);
  }
  foot(p, `Social · Gershon.AI  ·  ${m.label}  ·  social.gershoncrm.com`, build);
  return p;
}

export function companyPdf(win: MonthWindow, m: CompanyModel, build: string): MrPdf {
  const p = new MrPdf(PW, PH);
  let y = head(p, `Monthly report  ·  ${m.name}`, win.label, m.toName ? `Prepared for ${m.toName}` : `Prepared for ${m.name}`);
  y -= 50; banner(p, y, m.head, m.lead);
  y -= 14; sect(p, y, "Your headline numbers"); y -= 66; tiles(p, y, m.tiles);

  y -= 22;
  const LW = 330, RX = M + LW + 20;
  sect(p, y, "Posts per day", M, M + LW);
  if (m.themes.length) sect(p, y, "What you posted about", RX, PW - M);
  y -= 96;
  chart(p, M, y, LW, 90, win.dim, [{ vals: m.perDay, color: C.RED }], `${win.name} 1-${win.dim}`, [["LinkedIn + X", C.RED]]);
  let ry = y + 76;
  const tmax = Math.max(1, ...m.themes.map((t) => t[1]));
  for (const [t, v] of m.themes) {
    p.text(RX, ry, clip(t, 7.8, true, 140), 7.8, true, C.INK);
    p.rtext(PW - M, ry, `${v} post${v === 1 ? "" : "s"}`, 7.2, false, C.MUT);
    p.rect(RX, ry - 8, ((PW - M - RX) * v) / tmax, 5, C.LI); ry -= 20;
  }

  y -= 24; sect(p, y, "Your best posts"); y -= 8;
  m.top.forEach((t, i) => {
    y -= 22;
    p.text(M, y, `${i + 1}`, 13, true, C.RED);
    p.text(M + 16, y + 3, clip(t.text, 9, true, 330), 9, true, C.INK);
    p.text(M + 16, y - 6, `${t.date} · ${t.net}`, 7, false, C.MUT);
    p.rtext(PW - M, y + 3, `${fmt(t.likes)} likes · ${fmt(t.comments)} comments · ${fmt(t.shares)} shares`, 7.6, true, C.GOOD);
  });

  y -= 26; sect(p, y, "Your momentum"); y -= 22;
  y = goodNotes(p, y, m.momentum);
  if (m.ideas.length) {
    y -= 6; sect(p, y, `Ideas for ${win.nextName}`); y -= 22;
    goodNotes(p, y, m.ideas);
  }
  foot(p, "Social · Gershon.AI  ·  measured daily from your public LinkedIn and X pages", build);
  return p;
}
