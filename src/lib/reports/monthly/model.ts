/**
 * Monthly report — the POSITIVE-ONLY model.
 *
 * Olivier's rules (2026-10-01), enforced here so no renderer can break them:
 *   1. One report per client category (Campaigns, Clients, Partners, …), plus
 *      each campaign company's own report.
 *   2. Always ONE page.
 *   3. Highlight what went well — NEVER missed days, failures, red statuses,
 *      silent companies, or comparisons the company loses. A comparison with
 *      the previous month appears ONLY when it is a gain. Companies with no
 *      post in the month are simply left out.
 *   Problems still reach Olivier through the daily report, so nothing is hidden.
 *
 * Both the PDF and the HTML email are drawn from this model, so the two can
 * never say different things.
 */

export interface MonthWindow {
  key: string; // YYYY-MM
  y: number;
  m: number; // 0-based
  dim: number;
  name: string; // "September"
  mon3: string; // "Sep"
  label: string; // "SEPTEMBER 2026"
  prevName: string; // "August"
  nextName: string; // "October"
}

export interface ReportPost {
  company: string;
  date: string; // "Sep 17"
  net: string; // "LinkedIn" | "X"
  text: string;
  url: string | null;
  likes: number;
  comments: number;
  shares: number;
  eng: number;
}

export interface CompanyMonth {
  id: string;
  name: string;
  li: number;
  x: number;
  eng: number;
  days: number[]; // days of the month with ≥1 post
  perDay: number[]; // posts per day, length = dim
  perDayLi: number[];
  prev: { posts: number; eng: number; days: number };
  followers: { gain: number; li: number | null; x: number | null };
  top: ReportPost[];
  themes: Array<[string, number]>;
  bestWeekday: string | null;
}

export interface CategoryData {
  key: string;
  label: string; // "Campaigns"
  perCompany: boolean;
  companies: CompanyMonth[];
  delivered?: string[]; // companies whose own report went out
}

export interface CompanyExtras {
  competitors: Array<{ name: string; engPerPost: number }>; // same month
  gaps: string[]; // topics competitors use that this company doesn't
  recipientName: string | null;
  recipients: string[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;

export interface Tile { label: string; value: string; sub: string; color: "ink" | "good" | "red" }

export interface CategoryModel {
  kind: "category";
  key: string;
  label: string;
  title: string;
  sub: string;
  head: string;
  lead: string;
  tiles: Tile[];
  highlights: Array<[string, string, string]>;
  rows: Array<{ name: string; posts: number; days: number; eng: number; perPost: number; fol: number | null; note: string }>;
  perDay: number[];
  perDayLi: number[];
  top: ReportPost[];
  delivered: string[] | null;
  totals: { companies: number; posts: number; eng: number; followers: number };
}

export function categoryModel(win: MonthWindow, cat: CategoryData): CategoryModel | null {
  const active = cat.companies.filter((c) => c.li + c.x > 0);
  if (!active.length) return null; // nothing to celebrate → no report this month

  const sum = (f: (c: CompanyMonth) => number) => active.reduce((s, c) => s + f(c), 0);
  const posts = sum((c) => c.li + c.x);
  const postsPrev = cat.companies.reduce((s, c) => s + c.prev.posts, 0);
  const eng = sum((c) => c.eng);
  const engPrev = cat.companies.reduce((s, c) => s + c.prev.eng, 0);
  const fol = sum((c) => Math.max(0, c.followers.gain));
  const lower = cat.label.toLowerCase();

  // The true leader wins each award, even if one company takes several.
  const best = (f: (c: CompanyMonth) => number, ok: (c: CompanyMonth) => boolean = () => true) =>
    active.filter(ok).sort((a, b) => f(b) - f(a))[0];
  const mostEng = best((c) => c.eng, (c) => c.eng > 0);
  const mostActive = best((c) => c.li + c.x);
  const mostFol = best((c) => c.followers.gain, (c) => c.followers.gain > 0);
  const improved = best((c) => c.li + c.x - c.prev.posts, (c) => c.prev.posts > 0 && c.li + c.x > c.prev.posts);

  const highlights: Array<[string, string, string]> = [];
  if (mostEng) highlights.push(["MOST ENGAGEMENT", mostEng.name, `${fmt(mostEng.eng)} likes, comments and shares`]);
  highlights.push(["MOST ACTIVE", mostActive.name, `${plural(mostActive.li + mostActive.x, "post")} on ${plural(mostActive.days.length, "day")}`]);
  if (mostFol) highlights.push(["BIGGEST AUDIENCE GROWTH", mostFol.name, `+${fmt(mostFol.followers.gain)} followers`]);
  if (improved) highlights.push(["MOST IMPROVED", improved.name, `+${fmt(improved.li + improved.x - improved.prev.posts)} posts vs ${win.prevName}`]);

  const rows = active
    .slice()
    .sort((a, b) => b.eng - a.eng || b.li + b.x - (a.li + a.x))
    .map((c) => {
      const p = c.li + c.x;
      const up = c.prev.posts > 0 ? p - c.prev.posts : 0;
      const note =
        up > 0 ? `+${up} posts vs ${win.prevName}`
        : c.followers.gain > 0 ? `+${fmt(c.followers.gain)} followers`
        : c.eng > 0 ? `${fmt(Math.round(c.eng / p))} engagements per post`
        : `${plural(c.days.length, "day")} with a post`;
      return { name: c.name, posts: p, days: c.days.length, eng: c.eng, perPost: Math.round(c.eng / p), fol: c.followers.gain > 0 ? c.followers.gain : null, note };
    });

  const perDay = Array(win.dim).fill(0);
  const perDayLi = Array(win.dim).fill(0);
  for (const c of active) for (let i = 0; i < win.dim; i++) { perDay[i] += c.perDay[i] || 0; perDayLi[i] += c.perDayLi[i] || 0; }
  const days = perDay.filter((v) => v > 0).length;

  const top = active.flatMap((c) => c.top).sort((a, b) => b.eng - a.eng).slice(0, 5);

  const tiles: Tile[] = [
    { label: "POSTS PUBLISHED", value: fmt(posts), sub: posts > postsPrev && postsPrev > 0 ? `+${fmt(posts - postsPrev)} vs ${win.prevName}` : `${fmt(sum((c) => c.li))} LinkedIn · ${fmt(sum((c) => c.x))} X`, color: "ink" },
    eng > 0
      ? { label: "ENGAGEMENT", value: fmt(eng), sub: eng > engPrev && engPrev > 0 ? `+${fmt(eng - engPrev)} vs ${win.prevName}` : "likes, comments and shares", color: "good" }
      : { label: "ON LINKEDIN", value: fmt(sum((c) => c.li)), sub: `posts · ${fmt(sum((c) => c.x))} on X`, color: "good" },
    fol > 0
      ? { label: "FOLLOWERS GAINED", value: `+${fmt(fol)}`, sub: `across ${plural(active.filter((c) => c.followers.gain > 0).length, "company", "companies")}`, color: "good" }
      : { label: "POSTING DAYS", value: String(days), sub: "days with at least one post", color: "good" },
    { label: "COMPANIES PUBLISHING", value: String(active.length), sub: `${lower} active in ${win.name}`, color: "red" },
  ];

  const engUpPct = engPrev > 0 && eng > engPrev ? Math.round((100 * (eng - engPrev)) / engPrev) : 0;
  const head =
    engUpPct >= 1 ? `Engagement up ${engUpPct}% on ${win.prevName}.`
    : posts > postsPrev && postsPrev > 0 ? `${plural(posts - postsPrev, "more post")} than ${win.prevName}.`
    : `${win.name} in ${cat.label}: the highlights.`;
  const lead =
    `${plural(active.length, cat.key === "CAMPAIGN" ? "campaign company" : "company", cat.key === "CAMPAIGN" ? "campaign companies" : "companies")} published ${plural(posts, "post")} in ${win.name}, earning ${plural(eng, "engagement")}` +
    (fol > 0 ? ` and ${plural(fol, "new follower")}.` : ".");

  return {
    kind: "category",
    key: cat.key,
    label: cat.label,
    title: `${cat.label} report`,
    sub: `${plural(active.length, "company", "companies")} published`,
    head,
    lead,
    tiles,
    highlights,
    rows,
    perDay,
    perDayLi,
    top,
    delivered: cat.perCompany && cat.delivered?.length ? cat.delivered : null,
    totals: { companies: active.length, posts, eng, followers: fol },
  };
}

export interface CompanyModel {
  kind: "company";
  id: string;
  name: string;
  toName: string | null;
  head: string;
  lead: string;
  tiles: Tile[];
  perDay: number[];
  themes: Array<[string, number]>;
  top: ReportPost[];
  momentum: Array<[string, string]>;
  ideas: Array<[string, string]>;
}

export function companyModel(win: MonthWindow, c: CompanyMonth, x: CompanyExtras): CompanyModel | null {
  const posts = c.li + c.x;
  if (!posts) return null; // never send a company a report with nothing in it

  const prev = c.prev.posts;
  const engUp = c.prev.eng > 0 && c.eng > c.prev.eng ? Math.round((100 * (c.eng - c.prev.eng)) / c.prev.eng) : null;
  const perPost = Math.round(c.eng / posts);

  const tiles: Tile[] = [
    { label: "POSTS PUBLISHED", value: String(posts), sub: prev > 0 && posts > prev ? `+${posts - prev} vs ${win.prevName}` : `${c.li} LinkedIn · ${c.x} X`, color: "ink" },
    { label: "ENGAGEMENT", value: fmt(c.eng), sub: engUp ? `+${engUp}% vs ${win.prevName}` : "likes, comments and shares", color: "good" },
    c.followers.gain > 0
      ? { label: "NEW FOLLOWERS", value: `+${fmt(c.followers.gain)}`, sub: c.followers.li ? `${fmt(c.followers.li)} on LinkedIn now` : "this month", color: "good" }
      : { label: "PER POST", value: fmt(perPost), sub: "engagements per post", color: "good" },
    { label: "POSTING DAYS", value: String(c.days.length), sub: c.prev.days > 0 && c.days.length > c.prev.days ? `+${c.days.length - c.prev.days} vs ${win.prevName}` : "days with a post", color: "red" },
  ];

  // Only competitors this company beats on engagement per post, and only
  // when they actually posted — never a ranking it loses.
  const beaten = x.competitors.filter((k) => k.engPerPost > 0 && perPost > k.engPerPost).map((k) => k.name);

  const momentum: Array<[string, string]> = [];
  if (prev > 0 && posts > prev) momentum.push([`${plural(posts - prev, "more post")} than ${win.prevName}`, `${posts} posts in ${win.name}, against ${prev} the month before.`]);
  if (engUp) momentum.push([`Engagement up ${engUp}%`, `${plural(c.eng, "like, comment and share", "likes, comments and shares")} — ${perPost} per post.`]);
  if (c.followers.gain > 0) momentum.push([`+${plural(c.followers.gain, "new follower")}`, [c.followers.li ? `${fmt(c.followers.li)} on LinkedIn` : null, c.followers.x ? `${fmt(c.followers.x)} on X` : null].filter(Boolean).join(", ") + "."]);
  if (beaten.length) momentum.push([`More engagement per post than ${plural(beaten.length, "competitor")}`, `${beaten.slice(0, 5).join(", ")}${beaten.length > 5 ? " and others" : ""}.`]);
  if (c.days.length > c.prev.days && c.prev.days > 0) momentum.push([`${plural(c.days.length - c.prev.days, "more posting day")}`, `Posts went out on ${c.days.length} days in ${win.name}.`]);
  if (!momentum.length) momentum.push([`${plural(posts, "post")} published in ${win.name}`, `${plural(c.eng, "engagement")} across LinkedIn${c.x ? " and X" : ""}.`]);

  const ideas: Array<[string, string]> = [];
  const b = c.top[0];
  if (b && perPost > 0 && b.eng >= perPost * 1.5) {
    ideas.push([`Build on "${clipText(b.text, 60)}"`, `Your best post of the month earned ${(b.eng / perPost).toFixed(1)}x your average engagement — a follow-up or a series would compound it.`]);
  } else if (b) {
    ideas.push([`Build on "${clipText(b.text, 60)}"`, "Your best post of the month — a follow-up on the same subject keeps the momentum."]);
  }
  if (x.gaps.length) ideas.push([`Open new topics: ${x.gaps.slice(0, 2).join(" and ")}`, "Subjects your market is actively discussing, where you have expertise to share."]);
  if (c.li > 0 && c.x * 2 < c.li) ideas.push(["Bring your best LinkedIn posts to X", "The same content, reformatted for X, reaches a second audience at little extra effort."]);
  if (c.bestWeekday && ideas.length < 3) ideas.push([`Keep ${c.bestWeekday} in the plan`, `${c.bestWeekday} posts earned your highest engagement this month.`]);
  if (ideas.length < 3 && c.themes[0]) ideas.push([`More on ${c.themes[0][0].toLowerCase()}`, `Your most frequent subject this month — and a clear part of your voice.`]);

  const fol = c.followers.gain;
  return {
    kind: "company",
    id: c.id,
    name: c.name,
    toName: x.recipientName,
    head: `A strong ${win.name} for ${c.name}.`,
    lead: `${plural(posts, "post")}, ${plural(c.eng, "engagement")}` + (fol > 0 ? ` and ${plural(fol, "new follower")}` : "") + (engUp ? ` — engagement up ${engUp}% on ${win.prevName}.` : "."),
    tiles,
    perDay: c.perDay,
    themes: c.themes.slice(0, 4),
    top: c.top.slice(0, 3),
    momentum: momentum.slice(0, 4),
    ideas: ideas.slice(0, 3),
  };
}

export function clipText(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}
