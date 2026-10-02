/**
 * Monthly report — the model both renderers draw from.
 *
 * Olivier's rules (2026-10-01), enforced here so no renderer can break them:
 *   1. One report per client category (Campaigns, Clients, Partners, …), plus
 *      each campaign company's own report.
 *   2. Always ONE page.
 *   3. Highlight what went well — no missed days, failures, red statuses or
 *      comparisons a company loses; the previous month appears only when it is
 *      a gain.
 *   4. Campaigns are measured against their POSTING OBJECTIVE — posts per week,
 *      5 by default, set per company in Settings (WALLIX: 3). The % reached is
 *      the headline number, shown as it is (never coloured red).
 *   5. No follower counts — "focus on our objective".
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
  /** Campaign companies only: posts-per-week objective and the month's target. */
  objective: { perWeek: number; target: number } | null;
  top: ReportPost[];
  themes: Array<[string, number]>;
  bestWeekday: string | null;
  /** What the Competition report learns from (see competition.ts). */
  learn: {
    comments: number;
    hashtags: Array<[string, number]>; // tag → posts using it
    themeStats: Array<{ theme: string; posts: number; eng: number; comments: number }>;
    conversations: ReportPost[]; // posts with the most comments
    followers: number | null; // latest LinkedIn + X followers (COMPETITION only)
  };
}

export interface CategoryData {
  key: string;
  label: string; // "Campaigns"
  perCompany: boolean;
  objective: boolean; // measure against the posting objective
  defaultPerWeek?: number;
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
const pctOf = (posts: number, target: number) => (target > 0 ? Math.round((100 * posts) / target) : 0);
const perWeekLabel = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} a week`;

export interface Tile { label: string; value: string; sub: string; color: "ink" | "good" | "red" }

export interface CategoryRow {
  name: string;
  posts: number;
  days: number;
  eng: number;
  perPost: number;
  target: number | null;
  perWeek: number | null;
  pct: number | null;
  note: string;
}

export interface CategoryModel {
  kind: "category";
  key: string;
  label: string;
  objective: boolean;
  title: string;
  sub: string;
  head: string;
  lead: string;
  tiles: Tile[];
  highlights: Array<[string, string, string]>;
  rows: CategoryRow[];
  perDay: number[];
  perDayLi: number[];
  top: ReportPost[];
  delivered: string[] | null;
  totals: { companies: number; posts: number; eng: number; target: number | null; pct: number | null };
}

export function categoryModel(win: MonthWindow, cat: CategoryData): CategoryModel | null {
  const published = cat.companies.filter((c) => c.li + c.x > 0);
  // Campaigns: every company with an objective is measured, published or not —
  // the objective % must be the honest one. Other categories: only companies
  // that published.
  const listed = cat.objective ? cat.companies.filter((c) => c.objective || c.li + c.x > 0) : published;
  if (!published.length) return null; // nothing to report this month

  const sum = (arr: CompanyMonth[], f: (c: CompanyMonth) => number) => arr.reduce((s, c) => s + f(c), 0);
  const posts = sum(published, (c) => c.li + c.x);
  const postsPrev = sum(cat.companies, (c) => c.prev.posts);
  const eng = sum(published, (c) => c.eng);
  const engPrev = sum(cat.companies, (c) => c.prev.eng);
  const measured = listed.filter((c) => c.objective);
  const target = cat.objective ? sum(measured, (c) => c.objective!.target) : null;
  // Each company counts toward the objective up to its own target — one
  // company posting 3x its objective must not hide another one's shortfall.
  const delivered = sum(measured, (c) => Math.min(c.li + c.x, c.objective!.target));
  const pct = target ? pctOf(delivered, target) : null;
  const atObjective = measured.filter((c) => c.li + c.x >= c.objective!.target).length;
  const lower = cat.label.toLowerCase();

  // The true leader wins each award, even if one company takes several.
  const best = (f: (c: CompanyMonth) => number, ok: (c: CompanyMonth) => boolean = () => true) =>
    published.filter(ok).sort((a, b) => f(b) - f(a))[0];
  const mostEng = best((c) => c.eng, (c) => c.eng > 0);
  const mostActive = best((c) => c.li + c.x);
  const bestObj = cat.objective ? best((c) => (c.li + c.x) / (c.objective?.target || 1e9), (c) => !!c.objective) : undefined;
  const improved = best((c) => c.li + c.x - c.prev.posts, (c) => c.prev.posts > 0 && c.li + c.x > c.prev.posts);

  const highlights: Array<[string, string, string]> = [];
  if (bestObj?.objective) highlights.push(["BEST VS OBJECTIVE", bestObj.name, `${pctOf(bestObj.li + bestObj.x, bestObj.objective.target)}% · ${bestObj.li + bestObj.x} of ${bestObj.objective.target} posts`]);
  if (mostEng) highlights.push(["MOST ENGAGEMENT", mostEng.name, `${fmt(mostEng.eng)} likes, comments and shares`]);
  highlights.push(["MOST ACTIVE", mostActive.name, `${plural(mostActive.li + mostActive.x, "post")} on ${plural(mostActive.days.length, "day")}`]);
  if (improved) highlights.push(["MOST IMPROVED", improved.name, `+${fmt(improved.li + improved.x - improved.prev.posts)} posts vs ${win.prevName}`]);

  const rows: CategoryRow[] = listed
    .slice()
    .sort((a, b) =>
      cat.objective
        ? (b.li + b.x) / (b.objective?.target || 1e9) - (a.li + a.x) / (a.objective?.target || 1e9) || b.eng - a.eng
        : b.eng - a.eng || b.li + b.x - (a.li + a.x))
    .map((c) => {
      const p = c.li + c.x;
      const up = c.prev.posts > 0 ? p - c.prev.posts : 0;
      const cp = c.objective ? pctOf(p, c.objective.target) : null;
      const note =
        cp != null && cp >= 100 ? "Objective reached"
        : up > 0 ? `+${up} posts vs ${win.prevName}`
        : c.eng > 0 && p > 0 ? `${fmt(Math.round(c.eng / p))} engagements per post`
        : p > 0 ? `${plural(c.days.length, "day")} with a post`
        : "";
      return {
        name: c.name, posts: p, days: c.days.length, eng: c.eng, perPost: p ? Math.round(c.eng / p) : 0,
        target: c.objective?.target ?? null, perWeek: c.objective?.perWeek ?? null, pct: cp, note,
      };
    });

  const perDay = Array(win.dim).fill(0);
  const perDayLi = Array(win.dim).fill(0);
  for (const c of published) for (let i = 0; i < win.dim; i++) { perDay[i] += c.perDay[i] || 0; perDayLi[i] += c.perDayLi[i] || 0; }
  const days = perDay.filter((v) => v > 0).length;

  const top = published.flatMap((c) => c.top).sort((a, b) => b.eng - a.eng).slice(0, 5);

  const postsTile: Tile = { label: "POSTS PUBLISHED", value: fmt(posts), sub: posts > postsPrev && postsPrev > 0 ? `+${fmt(posts - postsPrev)} vs ${win.prevName}` : `${fmt(sum(published, (c) => c.li))} LinkedIn · ${fmt(sum(published, (c) => c.x))} X`, color: "ink" };
  const engTile: Tile = eng > 0
    ? { label: "ENGAGEMENT", value: fmt(eng), sub: eng > engPrev && engPrev > 0 ? `+${fmt(eng - engPrev)} vs ${win.prevName}` : "likes, comments and shares", color: "good" }
    : { label: "ON LINKEDIN", value: fmt(sum(published, (c) => c.li)), sub: `posts · ${fmt(sum(published, (c) => c.x))} on X`, color: "good" };

  const tiles: Tile[] = cat.objective && target
    ? [
        { label: "OBJECTIVE REACHED", value: `${pct}%`, sub: `${fmt(delivered)} of ${fmt(target)} objective posts`, color: pct! >= 100 ? "good" : "ink" },
        postsTile,
        engTile,
        { label: "AT OR ABOVE OBJECTIVE", value: `${atObjective} / ${measured.length}`, sub: `companies · ${perWeekLabel(cat.defaultPerWeek || 5)} by default`, color: "good" },
      ]
    : [
        postsTile,
        engTile,
        { label: "POSTING DAYS", value: String(days), sub: "days with at least one post", color: "good" },
        { label: "COMPANIES PUBLISHING", value: String(published.length), sub: `${lower} active in ${win.name}`, color: "red" },
      ];

  const engUpPct = engPrev > 0 && eng > engPrev ? Math.round((100 * (eng - engPrev)) / engPrev) : 0;
  const head = cat.objective && target
    ? `${cat.label} reached ${pct}% of their posting objective.`
    : engUpPct >= 1 ? `Engagement up ${engUpPct}% on ${win.prevName}.`
    : posts > postsPrev && postsPrev > 0 ? `${plural(posts - postsPrev, "more post")} than ${win.prevName}.`
    : `${win.name} in ${cat.label}: the highlights.`;
  const lead = cat.objective && target
    ? `${plural(posts, "post")} published — ${pct}% of the ${fmt(target)}-post objective` +
      (atObjective ? `; ${atObjective} of ${measured.length} companies reached theirs.` : ".")
    : `${plural(published.length, "company", "companies")} published ${plural(posts, "post")} in ${win.name}, earning ${plural(eng, "engagement")}.`;

  return {
    kind: "category",
    key: cat.key,
    label: cat.label,
    objective: !!(cat.objective && target),
    title: `${cat.label} report`,
    sub: cat.objective && target ? `objective: posts per week` : `${plural(published.length, "company", "companies")} published`,
    head,
    lead,
    tiles,
    highlights,
    rows,
    perDay,
    perDayLi,
    top,
    delivered: cat.perCompany && cat.delivered?.length ? cat.delivered : null,
    totals: { companies: published.length, posts, eng, target, pct },
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
  pct: number | null;
}

export function companyModel(win: MonthWindow, c: CompanyMonth, x: CompanyExtras): CompanyModel | null {
  const posts = c.li + c.x;
  if (!posts) return null; // never send a company a report with nothing in it

  const prev = c.prev.posts;
  const engUp = c.prev.eng > 0 && c.eng > c.prev.eng ? Math.round((100 * (c.eng - c.prev.eng)) / c.prev.eng) : null;
  const perPost = Math.round(c.eng / posts);
  const o = c.objective;
  const pct = o ? pctOf(posts, o.target) : null;

  const tiles: Tile[] = [
    o
      ? { label: "OBJECTIVE REACHED", value: `${pct}%`, sub: `${posts} of ${o.target} posts · ${perWeekLabel(o.perWeek)}`, color: pct! >= 100 ? "good" : "ink" }
      : { label: "POSTS PUBLISHED", value: String(posts), sub: `${c.li} LinkedIn · ${c.x} X`, color: "ink" },
    o
      ? { label: "POSTS PUBLISHED", value: String(posts), sub: prev > 0 && posts > prev ? `+${posts - prev} vs ${win.prevName}` : `${c.li} LinkedIn · ${c.x} X`, color: "ink" }
      : { label: "PER POST", value: fmt(perPost), sub: "engagements per post", color: "good" },
    { label: "ENGAGEMENT", value: fmt(c.eng), sub: engUp ? `+${engUp}% vs ${win.prevName}` : "likes, comments and shares", color: "good" },
    { label: "POSTING DAYS", value: String(c.days.length), sub: c.prev.days > 0 && c.days.length > c.prev.days ? `+${c.days.length - c.prev.days} vs ${win.prevName}` : "days with a post", color: "good" },
  ];

  // Only competitors this company beats on engagement per post — never a ranking it loses.
  const beaten = x.competitors.filter((k) => k.engPerPost > 0 && perPost > k.engPerPost).map((k) => k.name);

  const momentum: Array<[string, string]> = [];
  if (o && pct! >= 100) momentum.push([`Objective reached: ${pct}%`, `${posts} posts against an objective of ${o.target} (${perWeekLabel(o.perWeek)}).`]);
  if (prev > 0 && posts > prev) momentum.push([`${plural(posts - prev, "more post")} than ${win.prevName}`, `${posts} posts in ${win.name}, against ${prev} the month before.`]);
  if (engUp) momentum.push([`Engagement up ${engUp}%`, `${plural(c.eng, "like, comment and share", "likes, comments and shares")} — ${perPost} per post.`]);
  if (beaten.length) momentum.push([`More engagement per post than ${plural(beaten.length, "competitor")}`, `${beaten.slice(0, 5).join(", ")}${beaten.length > 5 ? " and others" : ""}.`]);
  if (c.days.length > c.prev.days && c.prev.days > 0) momentum.push([`${plural(c.days.length - c.prev.days, "more posting day")}`, `Posts went out on ${c.days.length} days in ${win.name}.`]);
  if (!momentum.length) momentum.push([`${plural(posts, "post")} published in ${win.name}`, `${plural(c.eng, "engagement")} across LinkedIn${c.x ? " and X" : ""}.`]);

  const ideas: Array<[string, string]> = [];
  if (o && pct! < 100) {
    const perWeekNow = Math.round(((posts * 7) / win.dim) * 10) / 10;
    ideas.push([`Reach ${perWeekLabel(o.perWeek)} in ${win.nextName}`, `You averaged ${perWeekNow} posts a week in ${win.name} — scheduling the week's posts in advance closes the gap.`]);
  }
  const b = c.top[0];
  if (b && perPost > 0 && b.eng >= perPost * 1.5) {
    ideas.push([`Build on "${clipText(b.text, 60)}"`, `Your best post of the month earned ${(b.eng / perPost).toFixed(1)}x your average engagement — a follow-up or a series would compound it.`]);
  } else if (b) {
    ideas.push([`Build on "${clipText(b.text, 60)}"`, "Your best post of the month — a follow-up on the same subject keeps the momentum."]);
  }
  if (x.gaps.length) ideas.push([`Open new topics: ${x.gaps.slice(0, 2).join(" and ")}`, "Subjects your market is actively discussing, where you have expertise to share."]);
  if (c.li > 0 && c.x * 2 < c.li) ideas.push(["Bring your best LinkedIn posts to X", "The same content, reformatted for X, reaches a second audience at little extra effort."]);
  if (c.bestWeekday && ideas.length < 3) ideas.push([`Keep ${c.bestWeekday} in the plan`, `${c.bestWeekday} posts earned your highest engagement this month.`]);
  if (ideas.length < 3 && c.themes[0]) ideas.push([`More on ${c.themes[0][0].toLowerCase()}`, "Your most frequent subject this month — and a clear part of your voice."]);

  return {
    kind: "company",
    id: c.id,
    name: c.name,
    toName: x.recipientName,
    head: o ? `${c.name} reached ${pct}% of its posting objective in ${win.name}.` : `A strong ${win.name} for ${c.name}.`,
    lead: o
      ? `${plural(posts, "post")} against an objective of ${o.target} (${perWeekLabel(o.perWeek)}), earning ${plural(c.eng, "engagement")}` + (engUp ? ` — engagement up ${engUp}% on ${win.prevName}.` : ".")
      : `${plural(posts, "post")} and ${plural(c.eng, "engagement")}` + (engUp ? ` — engagement up ${engUp}% on ${win.prevName}.` : "."),
    tiles,
    perDay: c.perDay,
    themes: c.themes.slice(0, 4),
    top: c.top.slice(0, 3),
    momentum: momentum.slice(0, 4),
    ideas: ideas.slice(0, 3),
    pct,
  };
}

export function clipText(s: string, n: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}
