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
import type { CategoryData, CompanyExtras, CompanyMonth, MonthWindow, ReportPost } from "./model";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Order + labels of the per-category reports. */
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
  shareCount: number; postTextSnippet: string | null; postUrl: string | null;
};
const POST_SELECT = { clientId: true, platform: true, publishedDateLocal: true, likeCount: true, commentCount: true, shareCount: true, postTextSnippet: true, postUrl: true } as const;
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
  fol: { gain: number; li: number | null; x: number | null }): CompanyMonth {
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
  const top: ReportPost[] = posts
    .filter((p) => (p.postTextSnippet || "").trim())
    .sort((a, b) => engOf(b) - engOf(a))
    .slice(0, 5)
    .map((p) => {
      const d = +p.publishedDateLocal.slice(8, 10);
      return {
        company: c.name, date: `${win.mon3} ${d}`, net: netOf(p.platform),
        text: (p.postTextSnippet || "").replace(/\s+/g, " ").trim().slice(0, 140),
        url: p.postUrl, likes: p.likeCount || 0, comments: p.commentCount || 0, shares: p.shareCount || 0, eng: engOf(p),
      };
    });
  return {
    id: c.id, name: c.name,
    li: posts.filter((p) => p.platform === "LINKEDIN").length,
    x: posts.filter((p) => p.platform !== "LINKEDIN").length,
    eng: posts.reduce((s, p) => s + engOf(p), 0),
    days: perDay.map((v, i) => (v > 0 ? i + 1 : 0)).filter(Boolean),
    perDay, perDayLi,
    prev: { posts: prev.length, eng: prev.reduce((s, p) => s + engOf(p), 0), days: new Set(prev.map((p) => p.publishedDateLocal)).size },
    followers: fol, top, themes: themesOf(posts), bestWeekday,
  };
}

/** Follower gain per client over the month: last snapshot minus the last one before (or the first in) the month. */
async function followerGains(clientIds: string[], win: MonthWindow): Promise<Map<string, { gain: number; li: number | null; x: number | null }>> {
  const out = new Map<string, { gain: number; li: number | null; x: number | null }>();
  if (!clientIds.length) return out;
  const { last } = bounds(win.y, win.m);
  const prevB = bounds(win.m === 0 ? win.y - 1 : win.y, (win.m + 11) % 12);
  const snaps = await prisma.followerSnapshot.findMany({
    where: { clientId: { in: clientIds }, snapshotDateLocal: { gte: prevB.first, lte: last } },
    select: { clientId: true, platformConnectionId: true, platform: true, snapshotDateLocal: true, followerCount: true },
    orderBy: { snapshotDateLocal: "asc" },
  });
  const per = new Map<string, { clientId: string; platform: string; base: number | null; end: number | null; firstIn: number | null }>();
  const monthStart = `${win.key}-01`;
  for (const s of snaps) {
    const k = s.platformConnectionId;
    const r = per.get(k) || { clientId: s.clientId, platform: s.platform, base: null, end: null, firstIn: null };
    if (s.snapshotDateLocal < monthStart) r.base = s.followerCount;
    else { if (r.firstIn == null) r.firstIn = s.followerCount; r.end = s.followerCount; }
    per.set(k, r);
  }
  for (const r of per.values()) {
    if (r.end == null) continue;
    const start = r.base ?? r.firstIn;
    const o = out.get(r.clientId) || { gain: 0, li: null, x: null };
    if (start != null && r.end > start) o.gain += r.end - start;
    if (r.platform === "LINKEDIN") o.li = r.end; else if (r.platform === "TWITTER") o.x = r.end;
    out.set(r.clientId, o);
  }
  return out;
}

export async function loadCategories(win: MonthWindow, orgId: string): Promise<CategoryData[]> {
  const clients = await prisma.client.findMany({
    where: { organizationId: orgId, status: { not: "ARCHIVED" } },
    select: { id: true, name: true, clientType: true },
  });
  const ids = clients.map((c) => c.id);
  const cur = bounds(win.y, win.m);
  const prevB = bounds(win.m === 0 ? win.y - 1 : win.y, (win.m + 11) % 12);
  const posts = await postsIn(ids, cur.first, cur.last);
  const prev = await postsIn(ids, prevB.first, prevB.last);
  const fol = await followerGains(ids, win);

  const by = (rows: PostRow[]) => {
    const m = new Map<string, PostRow[]>();
    for (const r of rows) { const a = m.get(r.clientId) || []; a.push(r); m.set(r.clientId, a); }
    return m;
  };
  const cm = by(posts), pm = by(prev);
  return CATEGORY_ORDER.map((cat) => ({
    key: cat.key, label: cat.label, perCompany: cat.perCompany,
    companies: clients
      .filter((c) => c.clientType === cat.key)
      .map((c) => shapeCompany(win, c, cm.get(c.id) || [], pm.get(c.id) || [], fol.get(c.id) || { gain: 0, li: null, x: null })),
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
