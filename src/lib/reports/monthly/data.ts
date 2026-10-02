/**
 * Monthly report — data layer. Reads one closed month for the PRIMARY
 * (Gershon Consulting) workspace and shapes it for model.ts.
 *
 * Kept to a handful of flat queries with narrow `select`s (no postTextFull,
 * no per-company loops over the posts table) — wide parallel reads are the
 * shape that has tripped Worker memory (1101/1102) before.
 */
import prisma from "@/lib/db";
import rawDb from "@/lib/db-raw";
import { THEMES } from "@/lib/competitors/analyze";
import { getCompetitorIds } from "@/lib/competitors/store";
import { DEFAULT_PER_WEEK, monthTarget, objectivesFor } from "@/lib/campaigns/objectives";
import type { CategoryData, CompanyExtras, CompanyMonth, MonthWindow, ReportPost } from "./model";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Order + labels of the per-category reports. CAMPAIGN is measured against its posting objective. */
export const CATEGORY_ORDER: Array<{ key: string; label: string; perCompany: boolean }> = [
  { key: "CAMPAIGN", label: "Campaigns", perCompany: true },
  { key: "CLIENT", label: "Clients", perCompany: false },
  { key: "PARTNER", label: "Partners", perCompany: false },
  { key: "PROSPECT", label: "Prospects", perCompany: false },
  { key: "INTERNAL", label: "Internal", perCompany: false },
  { key: "COMPANY", label: "Companies", perCompany: false },
  { key: "COMPETITION", label: "Competition", perCompany: false },
  { key: "RECYCLED", label: "Recycled", perCompany: false },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** The month that just closed (UTC), or an explicit YYYY-MM. */
export function monthWindow(key?: string | null, now = new Date()): MonthWindow {
  let y: number, m: number;
  if (key && /^\d{4}-\d{2}$/.test(key)) { y = +key.slice(0, 4); m = +key.slice(5, 7) - 1; }
  else { y = now.getUTCFullYear(); m = now.getUTCMonth() - 1; if (m < 0) { m = 11; y--; } }
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    key: `${y}-${pad(m + 1)}`, y, m, dim, name: MONTHS[m], mon3: MONTHS[m].slice(0, 3),
    label: `${MONTHS[m]} ${y}`.toUpperCase(), prevName: MONTHS[(m + 11) % 12], nextName: MONTHS[(m + 1) % 12],
  };
}
function bounds(y: number, m: number) {
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { first: `${y}-${pad(m + 1)}-01`, last: `${y}-${pad(m + 1)}-${pad(dim)}` };
}

export async function primaryOrgId(): Promise<string> {
  const org = await rawDb.organization.findFirst({ where: { isPrimary: true }, select: { id: true } });
  if (!org) throw new Error("No primary organization");
  return org.id;
}

type PostRow = {
  clientId: string; platform: string; publishedDateLocal: string; likeCount: number; commentCount: number;
  shareCount: number; postTextSnippet: string | null; postUrl: string | null; hashtags: string | null;
};
const POST_SELECT = { clientId: true, platform: true, publishedDateLocal: true, likeCount: true, commentCount: true, shareCount: true, postTextSnippet: true, postUrl: true, hashtags: true } as const;

/** Hashtags from the dedicated column (JSON or loose) and the text — same rule as lib/content/corpus.ts. */
function tagsOf(p: PostRow): string[] {
  const out = new Set<string>();
  if (p.hashtags) {
    let tags: string[] = [];
    try { const v = JSON.parse(p.hashtags); if (Array.isArray(v)) tags = v.map(String); } catch { tags = p.hashtags.split(/[,\s#]+/); }
    for (const t of tags) { const c = t.trim().replace(/^#/, "").toLowerCase(); if (c.length >= 2 && /\p{L}/u.test(c)) out.add(c); }
  }
  for (const m of (p.postTextSnippet || "").matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) if (/\p{L}/u.test(m[1])) out.add(m[1].toLowerCase());
  return Array.from(out);
}
const engOf = (p: PostRow) => (p.likeCount || 0) + (p.commentCount || 0) + (p.shareCount || 0);
const netOf = (platform: string) => (platform === "TWITTER" ? "X" : platform === "LINKEDIN" ? "LinkedIn" : platform.charAt(0) + platform.slice(1).toLowerCase());

async function postsIn(clientIds: string[], first: string, last: string): Promise<PostRow[]> {
  if (!clientIds.length) return [];
  return (await prisma.socialPost.findMany({
    where: { clientId: { in: clientIds }, publishedDateLocal: { gte: first, lte: last } },
    select: POST_SELECT,
  })) as PostRow[];
}

function themesOf(posts: PostRow[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const t = p.postTextSnippet || "";
    for (const th of THEMES) if (th.re.test(t)) counts.set(th.label, (counts.get(th.label) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function shapeCompany(win: MonthWindow, c: { id: string; name: string }, posts: PostRow[], prev: PostRow[],
  objective: CompanyMonth["objective"], followers: number | null = null): CompanyMonth {
  const perDay = Array(win.dim).fill(0), perDayLi = Array(win.dim).fill(0);
  const wd = new Map<number, { n: number; eng: number }>();
  for (const p of posts) {
    const d = +p.publishedDateLocal.slice(8, 10);
    if (d >= 1 && d <= win.dim) { perDay[d - 1]++; if (p.platform === "LINKEDIN") perDayLi[d - 1]++; }
    const w = new Date(Date.UTC(win.y, win.m, d)).getUTCDay();
    const s = wd.get(w) || { n: 0, eng: 0 }; s.n++; s.eng += engOf(p); wd.set(w, s);
  }
  const wdays = Array.from(wd.entries()).filter(([, s]) => s.n >= 2);
  const bestWeekday = wdays.length >= 2 ? WEEKDAYS[wdays.sort((a, b) => b[1].eng / b[1].n - a[1].eng / a[1].n)[0][0]] : null;
  const toPost = (p: PostRow): ReportPost => {
    const d = +p.publishedDateLocal.slice(8, 10);
    return {
      company: c.name, date: `${win.mon3} ${d}`, net: netOf(p.platform),
      text: (p.postTextSnippet || "").replace(/\s+/g, " ").trim().slice(0, 140),
      url: p.postUrl, likes: p.likeCount || 0, comments: p.commentCount || 0, shares: p.shareCount || 0, eng: engOf(p),
    };
  };
  const withText = posts.filter((p) => (p.postTextSnippet || "").trim());
  const top: ReportPost[] = withText.slice().sort((a, b) => engOf(b) - engOf(a)).slice(0, 5).map(toPost);

  // Learning data (used by the Competition report).
  const tagCount = new Map<string, number>();
  for (const p of posts) for (const t of tagsOf(p)) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const themeStat = new Map<string, { posts: number; eng: number; comments: number }>();
  for (const p of posts) for (const th of THEMES) if (th.re.test(p.postTextSnippet || "")) {
    const s = themeStat.get(th.label) || { posts: 0, eng: 0, comments: 0 };
    s.posts++; s.eng += engOf(p); s.comments += p.commentCount || 0; themeStat.set(th.label, s);
  }
  const learn: CompanyMonth["learn"] = {
    comments: posts.reduce((s, p) => s + (p.commentCount || 0), 0),
    hashtags: Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20),
    themeStats: Array.from(themeStat.entries()).map(([theme, s]) => ({ theme, ...s })),
    conversations: withText.filter((p) => (p.commentCount || 0) > 0).sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0)).slice(0, 3).map(toPost),
    followers,
  };
  return {
    id: c.id, name: c.name,
    li: posts.filter((p) => p.platform === "LINKEDIN").length,
    x: posts.filter((p) => p.platform !== "LINKEDIN").length,
    eng: posts.reduce((s, p) => s + engOf(p), 0),
    days: perDay.map((v, i) => (v > 0 ? i + 1 : 0)).filter(Boolean),
    perDay, perDayLi,
    prev: { posts: prev.length, eng: prev.reduce((s, p) => s + engOf(p), 0), days: new Set(prev.map((p) => p.publishedDateLocal)).size },
    objective, top, themes: themesOf(posts), bestWeekday, learn,
  };
}

/** Latest LinkedIn + X follower count per client, as of the month's last day. */
async function latestFollowers(clientIds: string[], last: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!clientIds.length) return out;
  const snaps = await prisma.followerSnapshot.findMany({
    where: { clientId: { in: clientIds }, snapshotDateLocal: { lte: last }, platform: { in: ["LINKEDIN", "TWITTER"] } },
    select: { clientId: true, platformConnectionId: true, snapshotDateLocal: true, followerCount: true },
    orderBy: { snapshotDateLocal: "desc" },
    take: 2000,
  });
  const seen = new Set<string>();
  for (const s of snaps) {
    if (seen.has(s.platformConnectionId)) continue;
    seen.add(s.platformConnectionId);
    out.set(s.clientId, (out.get(s.clientId) || 0) + s.followerCount);
  }
  return out;
}

export async function loadCategories(win: MonthWindow, orgId: string): Promise<CategoryData[]> {
  const clients = await prisma.client.findMany({
    where: { organizationId: orgId, status: { not: "ARCHIVED" } },
    select: { id: true, name: true, clientType: true, status: true },
  });
  const ids = clients.map((c) => c.id);
  const cur = bounds(win.y, win.m);
  const prevB = bounds(win.m === 0 ? win.y - 1 : win.y, (win.m + 11) % 12);
  const posts = await postsIn(ids, cur.first, cur.last);
  const prev = await postsIn(ids, prevB.first, prevB.last);

  // Latest follower count for COMPETITION companies ("who is most followed").
  const followers = await latestFollowers(clients.filter((c) => c.clientType === "COMPETITION").map((c) => c.id), cur.last);

  // Posting objective (posts / week) for ACTIVE campaign companies — Settings.
  const campaigns = clients.filter((c) => c.clientType === "CAMPAIGN");
  const obj = await objectivesFor(orgId, campaigns);

  const by = (rows: PostRow[]) => {
    const m = new Map<string, PostRow[]>();
    for (const r of rows) { const a = m.get(r.clientId) || []; a.push(r); m.set(r.clientId, a); }
    return m;
  };
  const cm = by(posts), pm = by(prev);
  return CATEGORY_ORDER.map((cat) => ({
    key: cat.key, label: cat.label, perCompany: cat.perCompany,
    objective: cat.key === "CAMPAIGN",
    defaultPerWeek: cat.key === "CAMPAIGN" ? obj.o.default : DEFAULT_PER_WEEK,
    companies: clients
      .filter((c) => c.clientType === cat.key)
      .map((c) => {
        const perWeek = obj.perWeek(c.id);
        const objective = cat.key === "CAMPAIGN" && c.status === "ACTIVE" ? { perWeek, target: monthTarget(perWeek, win.dim) } : null;
        return shapeCompany(win, c, cm.get(c.id) || [], pm.get(c.id) || [], objective, followers.get(c.id) ?? null);
      }),
  }));
}

/** Competitor comparison + recipients for one campaign company's own report. */
export async function loadCompanyExtras(win: MonthWindow, orgId: string, company: CompanyMonth): Promise<CompanyExtras> {
  const cur = bounds(win.y, win.m);
  const extras: CompanyExtras = { competitors: [], gaps: [], recipientName: null, recipients: [] };

  try {
    const compIds = (await getCompetitorIds(orgId, company.id)).slice(0, 12);
    if (compIds.length) {
      const comps = await prisma.client.findMany({ where: { id: { in: compIds } }, select: { id: true, name: true } });
      const posts = await postsIn(compIds, cur.first, cur.last);
      const selfThemes = new Set(company.themes.map(([t]) => t));
      const themeUse = new Map<string, number>();
      for (const k of comps) {
        const ps = posts.filter((p) => p.clientId === k.id);
        if (!ps.length) continue;
        extras.competitors.push({ name: k.name, engPerPost: Math.round(ps.reduce((s, p) => s + engOf(p), 0) / ps.length) });
        for (const [t] of themesOf(ps)) themeUse.set(t, (themeUse.get(t) || 0) + 1);
      }
      const minUse = extras.competitors.length >= 3 ? 2 : 1;
      extras.gaps = Array.from(themeUse.entries())
        .filter(([t, n]) => n >= minUse && !selfThemes.has(t))
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t);
    }
  } catch { /* competitor data is a bonus — never block the report on it */ }

  // Recipients: an explicit OrgSetting `report_email:<clientId>` wins; otherwise
  // every active, approved user whose email domain matches the company website.
  const setting = await rawDb.orgSetting.findUnique({
    where: { organizationId_key: { organizationId: orgId, key: `report_email:${company.id}` } },
  });
  const explicit = (setting?.value || "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => /.+@.+\..+/.test(s));
  if (explicit.length) {
    extras.recipients = explicit;
  } else {
    const c = await prisma.client.findFirst({ where: { id: company.id }, select: { website: true } });
    const domain = (c?.website || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    if (domain && !/gershon/.test(domain)) {
      const users = await rawDb.user.findMany({
        where: { isActive: true, pendingApproval: false, email: { endsWith: `@${domain}`, mode: "insensitive" } },
        select: { email: true, name: true },
        orderBy: { createdAt: "asc" },
      });
      extras.recipients = users.map((u) => u.email.toLowerCase());
      extras.recipientName = users[0]?.name || null;
    }
  }
  return extras;
}
