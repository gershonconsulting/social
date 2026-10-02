/**
 * Monthly COMPETITION report — a learning report, not a scorecard.
 *
 * Olivier, 2026-10-02: "The report for the campaign is different than the
 * report from the competition. We need to learn from the competition in this
 * report. What # are they using, how often they post, what subject brings
 * interest and comments, who are the most followed on related subjects."
 *
 * So, from the month's posts of every COMPETITION company:
 *   • who posts, how often (per week), engagement and comments per post, and
 *     who is most followed (latest LinkedIn + X follower count)
 *   • the subjects that bring engagement and comments (rule-based themes)
 *   • the hashtags they use, and how many competitors share each one
 *   • the posts that started the most conversation
 *   • three takeaways to apply to our own campaigns
 * Always one page. Model + PDF + email live here so the campaign renderers
 * stay untouched.
 */
import { MrPdf, strWidth as W, type RGB } from "./pdf-writer";
import type { CategoryData, CompanyMonth, MonthWindow, ReportPost } from "./model";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
const plural = (n: number, s: string, p = s + "s") => `${fmt(n)} ${n === 1 ? s : p}`;

export interface CompetitionModel {
  kind: "competition";
  key: string;
  label: string;
  head: string;
  lead: string;
  tiles: Array<{ label: string; value: string; sub: string }>;
  rows: Array<{ name: string; posts: number; perWeek: number; engPerPost: number; commentsPerPost: number; followers: number | null; topTag: string | null }>;
  subjects: Array<{ theme: string; posts: number; engPerPost: number; commentsPerPost: number }>;
  hashtags: Array<{ tag: string; posts: number; competitors: number }>;
  conversations: ReportPost[];
  lessons: Array<[string, string]>;
  totals: { companies: number; posts: number; eng: number; target: null; pct: null };
}

export function competitionModel(win: MonthWindow, cat: CategoryData): CompetitionModel | null {
  const active = cat.companies.filter((c) => c.li + c.x > 0);
  if (!active.length) return null;
  const weeks = win.dim / 7;
  const posts = active.reduce((s, c) => s + c.li + c.x, 0);
  const eng = active.reduce((s, c) => s + c.eng, 0);
  const comments = active.reduce((s, c) => s + c.learn.comments, 0);

  const rows = active
    .map((c) => {
      const p = c.li + c.x;
      return {
        name: c.name, posts: p, perWeek: Math.round((p / weeks) * 10) / 10,
        engPerPost: Math.round(c.eng / p), commentsPerPost: Math.round((c.learn.comments / p) * 10) / 10,
        followers: c.learn.followers, topTag: c.learn.hashtags[0]?.[0] ?? null,
      };
    })
    .sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1) || b.posts - a.posts);

  // Subjects: posts, engagement and comments per post, across all competitors.
  const th = new Map<string, { posts: number; eng: number; comments: number }>();
  for (const c of active) for (const t of c.learn.themeStats) {
    const s = th.get(t.theme) || { posts: 0, eng: 0, comments: 0 };
    s.posts += t.posts; s.eng += t.eng; s.comments += t.comments; th.set(t.theme, s);
  }
  const subjects = Array.from(th.entries())
    .filter(([, s]) => s.posts >= 2)
    .map(([theme, s]) => ({ theme, posts: s.posts, engPerPost: Math.round(s.eng / s.posts), commentsPerPost: Math.round((s.comments / s.posts) * 10) / 10 }))
    .sort((a, b) => b.engPerPost - a.engPerPost)
    .slice(0, 6);

  // Hashtags: number of posts using each, and how many competitors share it.
  const tags = new Map<string, { posts: number; who: Set<string> }>();
  for (const c of active) for (const [t, n] of c.learn.hashtags) {
    const s = tags.get(t) || { posts: 0, who: new Set<string>() };
    s.posts += n; s.who.add(c.name); tags.set(t, s);
  }
  const hashtags = Array.from(tags.entries())
    .map(([tag, s]) => ({ tag, posts: s.posts, competitors: s.who.size }))
    .sort((a, b) => b.competitors - a.competitors || b.posts - a.posts)
    .slice(0, 14);

  const conversations = active.flatMap((c) => c.learn.conversations).sort((a, b) => b.comments - a.comments).slice(0, 3);

  const mostFollowed = rows.find((r) => r.followers != null);
  const mostActive = rows.slice().sort((a, b) => b.perWeek - a.perWeek)[0];
  const sortedPw = rows.map((r) => r.perWeek).sort((a, b) => a - b);
  const medianPw = sortedPw[Math.floor(sortedPw.length / 2)];
  const bestSubject = subjects[0];
  const talkSubject = subjects.slice().sort((a, b) => b.commentsPerPost - a.commentsPerPost)[0];
  const engPerPost = Math.round(eng / posts);

  const tiles = [
    { label: "COMPETITORS ACTIVE", value: `${active.length} / ${cat.companies.length}`, sub: `${plural(posts, "post")} in ${win.name}` },
    { label: "POSTS PER WEEK", value: one(posts / weeks / active.length), sub: `average per competitor · top: ${one(mostActive.perWeek)}` },
    { label: "ENGAGEMENT PER POST", value: fmt(engPerPost), sub: `${one(comments / posts)} comments per post` },
    mostFollowed
      ? { label: "MOST FOLLOWED", value: fmt(mostFollowed.followers!), sub: mostFollowed.name }
      : { label: "HASHTAGS IN USE", value: String(tags.size), sub: "distinct hashtags this month" },
  ];

  const lessons: Array<[string, string]> = [];
  if (bestSubject) lessons.push([`Write about ${bestSubject.theme.toLowerCase()}`, `It earned ${fmt(bestSubject.engPerPost)} engagements per post across the competition — ${bestSubject.engPerPost > engPerPost ? `${one(bestSubject.engPerPost / Math.max(1, engPerPost))}x their average` : "their best subject"}.`]);
  if (talkSubject && talkSubject.commentsPerPost > 0 && talkSubject.theme !== bestSubject?.theme) lessons.push([`${talkSubject.theme} starts conversations`, `${one(talkSubject.commentsPerPost)} comments per post — the subject people answer most.`]);
  const shared = hashtags.filter((h) => h.competitors >= 2).slice(0, 4);
  if (shared.length) lessons.push([`Use the shared hashtags: ${shared.map((h) => "#" + h.tag).join(" ")}`, `Each is used by ${shared.length > 1 ? "at least 2" : shared[0].competitors} competitors — that is where the conversation in this market happens.`]);
  else if (hashtags.length) lessons.push([`Hashtags they rely on: ${hashtags.slice(0, 4).map((h) => "#" + h.tag).join(" ")}`, "Worth testing on our own posts in the same subjects."]);
  if (lessons.length < 3) lessons.push([`Match the pace: ${one(medianPw)} posts a week`, `That is the typical competitor; ${mostActive.name} leads at ${one(mostActive.perWeek)} a week.`]);

  const head = `What the competition did in ${win.name}.`;
  const lead =
    `${plural(active.length, "competitor")} published ${plural(posts, "post")} (${one(posts / weeks / active.length)} a week each on average)` +
    (bestSubject ? `; ${bestSubject.theme.toLowerCase()} earned the most engagement.` : ".");

  return {
    kind: "competition", key: cat.key, label: cat.label, head, lead, tiles, rows, subjects, hashtags, conversations,
    lessons: lessons.slice(0, 3), totals: { companies: active.length, posts, eng, target: null, pct: null },
  };
}

// ─────────────────────────────── PDF ───────────────────────────────
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const C = { RED: hex("#D92D20"), INK: hex("#111317"), MUT: hex("#6B7280"), RULE: hex("#E4E2DC"), TINT: hex("#F5F4F0"), LI: hex("#0A66C2"), LIB: hex("#E8F1FB"), WHITE: [1, 1, 1] as RGB };
const PW = 612, PH = 792, M = 40, CW = PW - 2 * M;
function clip(s: string, size: number, bold: boolean, max: number) {
  s = String(s ?? "");
  if (W(s, bold, size) <= max) return s;
  while (s.length && W(s + "…", bold, size) > max) s = s.slice(0, -1);
  return s + "…";
}
function sect(p: MrPdf, y: number, label: string, x0 = M, x1 = PW - M) {
  const L = label.toUpperCase();
  p.text(x0, y, L, 7.5, true, C.MUT);
  p.line(x0 + W(L, true, 7.5) + 8, y + 2.5, x1, C.RULE, 0.5);
}

export function competitionPdf(win: MonthWindow, m: CompetitionModel, build: string): MrPdf {
  const p = new MrPdf(PW, PH);
  let y = PH - M;
  p.rect(M, y - 4, 4, 34, C.RED);
  p.text(M + 14, y + 16, "SOCIAL", 17, true, C.INK);
  p.text(M + 14 + W("SOCIAL", true, 17) + 5, y + 16, "GERSHON.AI", 9, true, C.RED);
  p.text(M + 14, y + 3, "Competition report  ·  what we can learn", 9.5, false, C.MUT);
  p.rtext(PW - M, y + 16, win.label, 17, true, C.RED);
  p.rtext(PW - M, y + 4, "Social · Gershon.AI monthly report", 7.5, false, C.MUT);
  p.line(M, y - 20, PW - M, C.INK, 1.2);
  y -= 70;
  p.rect(M, y, CW, 40, C.TINT); p.rect(M, y, 3, 40, C.LI);
  p.text(M + 14, y + 24, clip(m.head, 12, true, CW - 24), 12, true, C.INK);
  p.text(M + 14, y + 10, clip(m.lead, 8.4, false, CW - 24), 8.4, false, C.INK);

  y -= 14; sect(p, y, "The month at a glance"); y -= 60;
  const tw = (CW - 3 * 9) / 4;
  m.tiles.forEach((t, i) => {
    const x = M + i * (tw + 9);
    p.rect(x, y, tw, 52, C.WHITE);
    p.line(x, y, x + tw, C.RULE, 0.5); p.rect(x, y, 0.5, 52, C.RULE); p.rect(x + tw - 0.5, y, 0.5, 52, C.RULE);
    p.rect(x, y + 49, tw, 3, C.LI);
    p.text(x + 10, y + 36, t.label, 6.4, true, C.MUT);
    p.text(x + 10, y + 17, clip(t.value, 18, true, tw - 16), 18, true, C.INK);
    p.text(x + 10, y + 6, clip(t.sub, 6.6, false, tw - 16), 6.6, false, C.MUT);
  });

  y -= 22; sect(p, y, "Who posts, how often, and who is most followed"); y -= 16;
  const X = { name: M + 2, posts: M + 196, wk: M + 244, eng: M + 298, com: M + 368, fol: M + 436, tag: M + 450 };
  p.rect(M, y - 5, CW, 15, C.TINT);
  p.text(X.name, y, "COMPETITOR", 6.4, true, C.MUT); p.rtext(X.posts, y, "POSTS", 6.4, true, C.MUT);
  p.rtext(X.wk, y, "PER WEEK", 6.4, true, C.MUT); p.rtext(X.eng, y, "ENG./POST", 6.4, true, C.MUT);
  p.rtext(X.com, y, "COMMENTS/POST", 6.4, true, C.MUT); p.rtext(X.fol, y, "FOLLOWERS", 6.4, true, C.MUT);
  p.text(X.tag, y, "TOP HASHTAG", 6.4, true, C.MUT);
  y -= 4;
  for (const r of m.rows.slice(0, 8)) {
    y -= 16; p.line(M, y + 12, PW - M, C.RULE, 0.4);
    p.text(X.name, y + 1, clip(r.name, 8, true, 150), 8, true, C.INK);
    p.rtext(X.posts, y + 1, fmt(r.posts), 7.8, false, C.INK);
    p.rtext(X.wk, y + 1, one(r.perWeek), 7.8, true, C.INK);
    p.rtext(X.eng, y + 1, fmt(r.engPerPost), 7.8, false, C.INK);
    p.rtext(X.com, y + 1, one(r.commentsPerPost), 7.8, false, C.INK);
    p.rtext(X.fol, y + 1, r.followers != null ? fmt(r.followers) : "", 7.8, true, C.INK);
    p.text(X.tag, y + 1, r.topTag ? clip("#" + r.topTag, 7.2, false, PW - M - X.tag) : "", 7.2, false, C.LI);
  }
  if (m.rows.length > 8) { y -= 11; p.text(M + 2, y, `+ ${m.rows.length - 8} more competitors in the dashboard.`, 6.6, false, C.MUT); }

  // subjects (left) + hashtags (right)
  y -= 22;
  const LW = 300, RX = M + LW + 20;
  sect(p, y, "Subjects that bring interest", M, M + LW); sect(p, y, "Hashtags they use", RX, PW - M);
  let ly = y - 14;
  p.text(M, ly, "SUBJECT", 6.2, true, C.MUT); p.rtext(M + 200, ly, "ENG. / POST", 6.2, true, C.MUT);
  p.rtext(M + 250, ly, "COMMENTS", 6.2, true, C.MUT); p.rtext(M + LW, ly, "POSTS", 6.2, true, C.MUT);
  const maxE = Math.max(1, ...m.subjects.map((s) => s.engPerPost));
  for (const s of m.subjects) {
    ly -= 15;
    p.rect(M, ly - 3, (110 * s.engPerPost) / maxE, 10, C.LIB);
    p.text(M + 3, ly, clip(s.theme, 7.6, true, 140), 7.6, true, C.INK);
    p.rtext(M + 200, ly, fmt(s.engPerPost), 7.6, true, C.INK);
    p.rtext(M + 250, ly, one(s.commentsPerPost), 7.6, false, C.INK);
    p.rtext(M + LW, ly, String(s.posts), 7.6, false, C.MUT);
  }
  if (!m.subjects.length) { ly -= 15; p.text(M, ly, "Not enough posts to compare subjects this month.", 7, false, C.MUT); }
  let kx = RX, ky = y - 16;
  for (const h of m.hashtags) {
    const label = `#${h.tag}  ${h.posts}`;
    const w = W(label, true, 7) + 12;
    if (kx + w > PW - M) { kx = RX; ky -= 15; if (ky < y - 108) break; }
    p.rect(kx, ky - 3, w, 12, C.LIB); p.text(kx + 6, ky, clip(label, 7, true, w - 10), 7, true, C.LI); kx += w + 5;
  }
  if (!m.hashtags.length) p.text(RX, ky, "No hashtags used this month.", 7, false, C.MUT);
  y = Math.min(ly, ky) - 6;

  if (m.conversations.length) {
    y -= 20; sect(p, y, "Posts that started conversations"); y -= 4;
    for (const t of m.conversations) {
      y -= 16;
      p.text(M, y, clip(t.text, 8, true, 300), 8, true, C.INK);
      p.text(M + 312, y, clip(`${t.company}  ·  ${t.net}  ·  ${t.date}`, 7, false, 130), 7, false, C.MUT);
      p.rtext(PW - M, y, `${fmt(t.comments)} comments · ${fmt(t.likes)} likes`, 7.4, true, C.INK);
    }
  }

  y -= 20; sect(p, y, "What we can learn"); y -= 20;
  for (const n of m.lessons) {
    p.rect(M, y - 2, 3, 20, C.LI);
    p.text(M + 12, y + 10, clip(n[0], 8.6, true, CW - 14), 8.6, true, C.INK);
    p.text(M + 12, y + 1, clip(n[1], 7.3, false, CW - 14), 7.3, false, C.MUT);
    y -= 24;
  }
  const fy = M - 8;
  p.line(M, fy + 14, PW - M, C.RULE, 0.5);
  p.text(M, fy + 4, "Social · Gershon.AI  ·  Competition  ·  from the competitors' public LinkedIn and X pages", 6.6, false, C.MUT);
  p.rtext(PW - M, fy + 4, build, 6.6, false, C.MUT);
  return p;
}

// ─────────────────────────────── EMAIL ───────────────────────────────
const K = { red: "#D92D20", ink: "#111317", mut: "#6B7280", rule: "#E4E2DC", tint: "#F5F4F0", li: "#0A66C2", lib: "#E8F1FB" };
const F = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const e = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sec = (t: string) => `<tr><td style="padding:22px 28px 8px"><div style="font-size:11px;font-weight:700;letter-spacing:.8px;color:${K.mut};border-bottom:1px solid ${K.rule};padding-bottom:6px">${e(t.toUpperCase())}</div></td></tr>`;
const th = (t: string, a = "left") => `<td align="${a}" style="font-size:10px;font-weight:700;letter-spacing:.5px;color:${K.mut};padding:7px 6px;background:${K.tint}">${t}</td>`;
const td = (t: string | number, s = "", a = "left") => `<td align="${a}" style="font-size:12px;color:${K.ink};padding:7px 6px;border-top:1px solid ${K.rule};${s}">${t}</td>`;

export function competitionSubject(win: MonthWindow, m: CompetitionModel): string {
  return `Social Report — Competition — ${win.name} ${win.y} · what we can learn · ${fmt(m.totals.posts)} competitor posts`;
}

export function competitionHtml(win: MonthWindow, m: CompetitionModel, build: string): string {
  const app = process.env.NEXT_PUBLIC_APP_URL || "https://social.gershoncrm.com";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${K.tint}">
<div style="display:none;max-height:0;overflow:hidden">${e(m.lead)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${K.tint};${F}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#fff;border:1px solid ${K.rule}">
<tr><td style="background:#111317;padding:20px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="border-left:4px solid ${K.red};padding-left:12px;${F}"><div style="font-size:20px;font-weight:700;color:#fff">SOCIAL <span style="font-size:11px;color:${K.red}">GERSHON.AI</span></div>
<div style="font-size:13px;color:#A8ABB2;margin-top:2px">Competition report · what we can learn</div></td>
<td align="right" style="${F}"><div style="font-size:20px;font-weight:700;color:${K.red}">${e(win.name.toUpperCase())} ${win.y}</div><div style="font-size:11px;color:#A8ABB2;margin-top:2px">monthly report</div></td></tr></table></td></tr>
<tr><td style="padding:22px 28px 6px"><div style="background:${K.tint};border-left:3px solid ${K.li};padding:14px 16px">
<div style="font-size:17px;font-weight:700;color:${K.ink}">${e(m.head)}</div><div style="font-size:13px;color:${K.ink};margin-top:4px;line-height:1.5">${e(m.lead)}</div></div></td></tr>
${sec("The month at a glance")}
<tr><td style="padding:4px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
${m.tiles.map((t) => `<td width="25%" valign="top" style="border:1px solid ${K.rule};border-top:3px solid ${K.li};padding:10px 12px"><div style="font-size:10px;font-weight:700;letter-spacing:.6px;color:${K.mut}">${e(t.label)}</div><div style="font-size:22px;font-weight:700;color:${K.ink};margin:4px 0 2px">${e(t.value)}</div><div style="font-size:11px;color:${K.mut}">${e(t.sub)}</div></td>`).join("")}
</tr></table></td></tr>
${sec("Who posts, how often, and who is most followed")}
<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${th("COMPETITOR")}${th("POSTS", "right")}${th("PER WEEK", "right")}${th("ENG./POST", "right")}${th("COMMENTS/POST", "right")}${th("FOLLOWERS", "right")}${th("TOP #")}</tr>
${m.rows.map((r) => `<tr>${td(`<b>${e(r.name)}</b>`)}${td(fmt(r.posts), "", "right")}${td(`<b>${one(r.perWeek)}</b>`, "", "right")}${td(fmt(r.engPerPost), "", "right")}${td(one(r.commentsPerPost), "", "right")}${td(r.followers != null ? `<b>${fmt(r.followers)}</b>` : "", "", "right")}${td(r.topTag ? "#" + e(r.topTag) : "", `color:${K.li};font-size:11px`)}</tr>`).join("")}
</table></td></tr>
${sec("Subjects that bring interest")}
<tr><td style="padding:0 22px">${m.subjects.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${th("SUBJECT")}${th("ENGAGEMENT / POST", "right")}${th("COMMENTS / POST", "right")}${th("POSTS", "right")}</tr>
${m.subjects.map((s) => `<tr>${td(`<b>${e(s.theme)}</b>`)}${td(`<b>${fmt(s.engPerPost)}</b>`, "", "right")}${td(one(s.commentsPerPost), "", "right")}${td(s.posts, `color:${K.mut}`, "right")}</tr>`).join("")}
</table>` : `<div style="font-size:12px;color:${K.mut};padding:0 6px">Not enough posts to compare subjects this month.</div>`}</td></tr>
${sec("Hashtags they use")}
<tr><td style="padding:0 28px">${m.hashtags.map((h) => `<span style="display:inline-block;background:${K.lib};color:${K.li};font-size:12px;font-weight:700;padding:4px 9px;margin:0 4px 6px 0">#${e(h.tag)} <span style="font-weight:400">${h.posts} posts · ${h.competitors} ${h.competitors === 1 ? "competitor" : "competitors"}</span></span>`).join("") || `<span style="font-size:12px;color:${K.mut}">No hashtags used this month.</span>`}</td></tr>
${m.conversations.length ? `${sec("Posts that started conversations")}
<tr><td style="padding:0 28px">${m.conversations.map((t) => `<div style="margin:8px 0"><div style="font-size:13px;font-weight:700;color:${K.ink}">${t.url ? `<a href="${e(t.url)}" style="color:${K.ink};text-decoration:none">${e(t.text)}</a>` : e(t.text)}</div><div style="font-size:11px;color:${K.mut};margin-top:2px"><b style="color:${K.ink}">${fmt(t.comments)} comments · ${fmt(t.likes)} likes</b> · ${e(t.company)} · ${e(t.net)} · ${e(t.date)}</div></div>`).join("")}</td></tr>` : ""}
${sec("What we can learn")}
<tr><td style="padding:0 28px">${m.lessons.map((n) => `<div style="border-left:3px solid ${K.li};padding:2px 0 2px 12px;margin:10px 0"><div style="font-size:13px;font-weight:700;color:${K.ink}">${e(n[0])}</div><div style="font-size:12px;color:${K.mut};margin-top:2px">${e(n[1])}</div></div>`).join("")}</td></tr>
<tr><td style="padding:16px 28px 0"><a href="${app}/dashboard" style="display:inline-block;background:${K.red};color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:10px 18px">Open the dashboard</a></td></tr>
<tr><td style="padding:24px 28px 22px"><div style="border-top:1px solid ${K.rule};padding-top:10px;font-size:11px;color:${K.mut}">Social · Gershon.AI · Competition · The same report is attached as a one-page PDF.<span style="float:right">${e(build)}</span></div></td></tr>
</table></td></tr></table></body></html>`;
}
