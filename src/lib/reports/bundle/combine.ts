/**
 * Report bundling (v4.82.0) — Olivier, 2026-11-23: "Too many reports from this
 * platform. How do we consolidate?" → option 1: one email per mailbox per cadence.
 *
 *   • Daily brief    — Collection + Posting + Competitive + Intelligence + Digest
 *                      in ONE email (alerts as a banner on top).
 *   • Friday pack    — the 3 reports × every client in ONE email (was 42).
 *   • Monthly        — the category PDFs in ONE email (was 8).
 *
 * This file is pure (no DB / network) so tests/bundle.test.mts runs it as is.
 * Every existing report keeps its own renderer; this only stitches the bodies.
 */

export type Section = { id: string; title: string; html: string; note?: string };
export type Alert = { level: "critical" | "warn"; text: string };

const RED = "#FE1B04";
const INK = "#1d1d1f";
const GREY = "#6b7280";
const BORDER = "#e5e7eb";

export const escHtml = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The inside of a full HTML email (what sits between <body> and </body>), without <style>/<title>/<script>. */
export function bodyOf(html: string): string {
  let s = html || "";
  const m = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (m) s = m[1];
  else s = s.replace(/<!doctype[^>]*>/i, "").replace(/<head[\s\S]*?<\/head>/i, "").replace(/<\/?html[^>]*>/gi, "");
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<title[\s\S]*?<\/title>/gi, "")
    .trim();
}

/** Anchor-safe id. */
export function slugId(s: string): string {
  return (s || "section").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}

export function alertsBanner(alerts: Alert[]): string {
  if (!alerts.length) return "";
  const critical = alerts.some((a) => a.level === "critical");
  const bg = critical ? "#fff5f5" : "#fffbeb";
  const fg = critical ? "#d11200" : "#78350f";
  const edge = critical ? RED : "#f59e0b";
  const items = alerts.map((a) => `<li style="margin:2px 0;">${a.level === "critical" ? "⛔" : "⚠️"} ${escHtml(a.text)}</li>`).join("");
  return `<div style="margin:0 0 16px;padding:12px 16px;background:${bg};border-left:4px solid ${edge};border-radius:6px;color:${fg};font-size:14px;line-height:1.5;">
<div style="font-weight:800;margin-bottom:4px;">${critical ? "Needs attention now" : "Heads-up"}</div>
<ul style="margin:0;padding-left:18px;">${items}</ul></div>`;
}

/** One email from several report sections, with a clickable table of contents. */
export function combineEmail(opts: { title: string; subtitle?: string; alerts?: Alert[]; sections: Section[]; footer?: string }): string {
  const sections = opts.sections.filter((s) => s.html && s.html.trim());
  const toc = sections.length > 1
    ? `<div style="margin:0 0 16px;padding:10px 14px;border:1px solid ${BORDER};border-radius:8px;font-size:13px;color:${INK};">
<div style="font-weight:700;margin-bottom:4px;">In this email</div>
${sections.map((s, i) => `<div style="margin:2px 0;">${i + 1}. <a href="#${s.id}" style="color:${RED};text-decoration:none;">${escHtml(s.title)}</a>${s.note ? ` <span style="color:${GREY};">— ${escHtml(s.note)}</span>` : ""}</div>`).join("")}
</div>`
    : "";
  const body = sections
    .map((s, i) => `<a name="${s.id}" id="${s.id}"></a>
<div style="margin:${i ? "28px" : "0"} 0 8px;padding:8px 0;border-bottom:2px solid ${RED};font-size:16px;font-weight:800;color:${INK};">${i + 1}. ${escHtml(s.title)}</div>
<div>${bodyOf(s.html)}</div>`)
    .join("\n");
  const empty = sections.length ? "" : `<p style="color:${GREY};">Nothing to report.</p>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${INK};">
<div style="max-width:760px;margin:0 auto;padding:20px 16px;background:#ffffff;">
<div style="font-size:20px;font-weight:800;color:${INK};">${escHtml(opts.title)}</div>
${opts.subtitle ? `<div style="font-size:13px;color:${GREY};margin:2px 0 14px;">${escHtml(opts.subtitle)}</div>` : `<div style="height:14px;"></div>`}
${alertsBanner(opts.alerts || [])}
${toc}
${body}${empty}
${opts.footer ? `<div style="margin-top:24px;padding-top:10px;border-top:1px solid ${BORDER};font-size:11px;color:${GREY};">${opts.footer}</div>` : ""}
</div></body></html>`;
}

/** Subject of the daily brief: the collection verdict leads, so a bad day still jumps out. */
export function dailyBriefSubject(opts: { day: string; workspace: string; collectionLevel: "ok" | "warn" | "critical"; extensionCritical?: boolean; alerts: number; tail?: string }): string {
  const base = `Social.gershon.ai — ${opts.workspace} — Daily brief — ${opts.day}`;
  if (opts.collectionLevel === "critical") return `⛔ NO COLLECTION — ${base}`;
  if (opts.extensionCritical) return `⚠️ Extension out of date — ${base}`;
  if (opts.alerts > 0) return `⚠️ ${base}${opts.tail ? ` — ${opts.tail}` : ""}`;
  return `${base}${opts.tail ? ` — ${opts.tail}` : ""}`;
}

/** Friday pack: one row per client with its three report links. */
export type PackEntry = {
  clientId: string;
  name: string;
  type: string;
  posts: number;
  postsPrev: number;
  engagement: number;
  competitors: number;
  rank: number | null;
  headline: string;
  links: { company: string; competitive: string; intelligence: string };
};

export function packEntryHtml(e: PackEntry): string {
  const delta = e.posts - e.postsPrev;
  const trend = delta === 0 ? "same as last week" : `${delta > 0 ? "+" : ""}${delta} vs last week`;
  const rank = e.rank && e.competitors ? ` · rank #${e.rank} of ${e.competitors + 1} on posts` : "";
  const btn = (href: string, label: string) =>
    `<a href="${escHtml(href)}" style="display:inline-block;margin:4px 6px 0 0;padding:6px 10px;border:1px solid ${RED};border-radius:6px;color:${RED};font-size:12px;font-weight:700;text-decoration:none;">${label}</a>`;
  return `<div style="margin:0 0 12px;padding:12px 14px;border:1px solid ${BORDER};border-radius:8px;">
<div style="font-size:15px;font-weight:800;">${escHtml(e.name)} <span style="font-size:11px;font-weight:600;color:${GREY};">${escHtml(e.type)}</span></div>
<div style="font-size:13px;color:${INK};margin:4px 0;">${e.posts} posts (${trend}) · ${e.engagement} engagement · ${e.competitors} competitor${e.competitors === 1 ? "" : "s"} watched${rank}</div>
${e.headline ? `<div style="font-size:13px;color:${GREY};margin:4px 0;">${escHtml(e.headline)}</div>` : ""}
<div>${btn(e.links.company, "Company report")}${btn(e.links.competitive, "Competitive report")}${btn(e.links.intelligence, "Intelligence report")}</div>
</div>`;
}

export function fridayPackHtml(opts: { weekLabel: string; entries: PackEntry[]; site: string }): string {
  const entries = [...opts.entries].sort((a, b) => a.name.localeCompare(b.name));
  const total = entries.reduce((n, e) => n + e.posts, 0);
  const quiet = entries.filter((e) => e.posts === 0).map((e) => e.name);
  const alerts: Alert[] = quiet.length ? [{ level: "warn", text: `No post collected this week for: ${quiet.join(", ")}` }] : [];
  return combineEmail({
    title: `Friday client pack — week of ${opts.weekLabel}`,
    subtitle: `${entries.length} clients · ${total} posts collected · for review before anything goes to a client`,
    alerts,
    sections: [{ id: "clients", title: "Clients", html: entries.map(packEntryHtml).join("\n") }],
    footer: `Each button opens the full report on ${escHtml(opts.site.replace(/^https?:\/\//, ""))} (sign-in needed). Replaces the 3 separate emails per client.`,
  });
}

/** Build a pack row from a client's Friday data (pure: only the fields it reads). */
export function packEntryFrom(
  d: {
    client: { id: string; name: string; clientType: string };
    self: { postsWeek: number; postsPrev: number; engagementWeek: number; mainTopic: string | null };
    competitors: unknown[];
    comparison: { rankByPosts: number; gaps: Array<{ term: string }> };
  },
  site: string,
): PackEntry {
  const base = `${site}/api/report/friday?client=${encodeURIComponent(d.client.id)}&kind=`;
  const bits: string[] = [];
  if (d.self.mainTopic) bits.push(`Main topic: ${d.self.mainTopic}`);
  const gaps = d.comparison.gaps.slice(0, 3).map((g) => g.term);
  if (gaps.length) bits.push(`Competitors talk about, the client does not: ${gaps.join(", ")}`);
  return {
    clientId: d.client.id,
    name: d.client.name,
    type: d.client.clientType,
    posts: d.self.postsWeek,
    postsPrev: d.self.postsPrev,
    engagement: d.self.engagementWeek,
    competitors: d.competitors.length,
    rank: d.competitors.length ? d.comparison.rankByPosts : null,
    headline: bits.join(" · "),
    links: { company: `${base}company`, competitive: `${base}competitive`, intelligence: `${base}intelligence` },
  };
}
