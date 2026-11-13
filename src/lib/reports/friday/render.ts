/**
 * Friday client reports (v4.78.0) — the three e-mails per client:
 *   Company report       what the client itself published this week
 *   Competitive report   the client vs the competitors linked in Competitor Watch
 *   Intelligence report  insights + next-week actions, each with the data behind it
 */
import { APP_VERSION } from "@/lib/extension-version";
import { socialSubject } from "@/lib/email/subject";
import { banner, BORDER, esc, fmt, GREY, INK, kpis, pill, RED, section, shortDay, SITE, table, TD, TDR, TH, THR, type Level } from "../ops/shell";
import { trend, type CompanyStats, type FPost } from "./analyze";
import type { FridayData } from "./data";
import type { IntelResult } from "./intel";

export type FridayKind = "company" | "competitive" | "intelligence";
export const FRIDAY_KINDS: FridayKind[] = ["company", "competitive", "intelligence"];
const TYPE: Record<FridayKind, string> = { company: "Company report", competitive: "Competitive report", intelligence: "Intelligence report" };

export function fridaySubject(kind: FridayKind, d: Pick<FridayData, "client" | "weekLabel">): string {
  return `${socialSubject(d.client.name, TYPE[kind])} (week of ${d.weekLabel})`;
}

const clientUrl = (id: string) => `${SITE}/clients/${id}`;

function shell(kind: FridayKind, d: FridayData, body: string): string {
  const host = SITE.replace(/^https?:\/\//, "");
  const others = FRIDAY_KINDS.filter((k) => k !== kind)
    .map((k) => `<a href="${SITE}/api/report/friday?client=${d.client.id}&kind=${k}" style="color:${RED};font-weight:700;text-decoration:none;">${TYPE[k]}</a>`)
    .join(" · ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(fridaySubject(kind, d))}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${INK};">
<div style="max-width:680px;margin:0 auto;background:#ffffff;">
  <div style="height:4px;background:${RED};line-height:4px;font-size:0;">&nbsp;</div>
  <div style="padding:20px 24px 16px;border-bottom:1px solid ${BORDER};">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${RED};font-weight:700;">Social.gershon.ai · Friday report · for review</div>
    <div style="font-size:22px;font-weight:800;margin-top:4px;">${esc(d.client.name)} — ${TYPE[kind]}</div>
    <div style="font-size:13px;color:#4b5563;margin-top:4px;">Week of ${esc(d.weekLabel)} (ET) · compared with the week before</div>
    <div style="font-size:12px;margin-top:10px;">Also this week: ${others}</div>
  </div>
  ${body}
  <div style="padding:18px 24px;text-align:center;border-top:1px solid ${BORDER};">
    <a href="${clientUrl(d.client.id)}" style="display:inline-block;padding:11px 22px;background:${RED};color:#ffffff;font-weight:700;font-size:13px;text-decoration:none;border-radius:8px;">Open ${esc(d.client.name)} in Social →</a>
  </div>
  <div style="padding:14px 24px;border-top:1px solid ${BORDER};font-size:11px;line-height:1.5;color:${GREY};">
    Source: ${esc(host)} (posts collected by the Chrome extension on LinkedIn and X) · Week ${esc(d.window.weekFrom)} → ${esc(d.window.weekTo)} ET · app v${esc(APP_VERSION)} · Engagement = likes + 2×comments + 3×shares.
  </div>
</div></body></html>`;
}

function levelOf(s: CompanyStats): Level {
  return s.postsWeek === 0 ? "critical" : s.postsWeek < s.postsPrev ? "warn" : "ok";
}

function postList(posts: FPost[], showCompany: boolean): string {
  if (!posts.length) return `<div style="font-size:13px;color:${GREY};">No post collected.</div>`;
  return posts
    .map(
      (p) => `<div style="padding:10px 0;border-bottom:1px solid #f1f1f1;">
      <div style="font-size:11px;color:${GREY};">${showCompany ? `<b style="color:${INK};">${esc(p.company)}</b> · ` : ""}${esc(shortDay(p.date))} · ${p.platform === "LINKEDIN" ? "LinkedIn" : "X"} · ${fmt(p.likes)} likes · ${fmt(p.comments)} comments · ${fmt(p.shares)} shares</div>
      <div style="font-size:13px;line-height:1.45;margin-top:3px;">${esc(p.text.slice(0, 260))}${p.text.length > 260 ? "…" : ""}</div>
      ${p.url ? `<div style="margin-top:3px;"><a href="${esc(p.url)}" style="font-size:12px;color:${RED};font-weight:700;text-decoration:none;">Open the post →</a></div>` : ""}
    </div>`,
    )
    .join("");
}

function chips(items: Array<{ term: string; count: number }>, prefix = ""): string {
  if (!items.length) return `<span style="font-size:12px;color:${GREY};">—</span>`;
  return items.map((t) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;border-radius:999px;background:#f3f4f6;font-size:12px;">${esc(prefix + t.term)} <b>${t.count}</b></span>`).join("");
}

function bar(value: number, max: number, color: string): string {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 140)) : 2;
  return `<span style="display:inline-block;height:9px;width:${w}px;background:${color};border-radius:3px;vertical-align:middle;"></span>`;
}

// ── Company ─────────────────────────────────────────────────────────────────

export function renderCompany(d: FridayData): string {
  const s = d.self;
  const lvl = levelOf(s);
  const head =
    s.postsWeek === 0
      ? banner("critical", `No post collected for ${s.name} this week`, `Last post seen: ${s.lastPostKey ? esc(shortDay(s.lastPostKey)) + " (" + esc(s.lastPostKey) + ")" : "never"}. Either nothing was published or the collector missed it.`)
      : banner(lvl, `${s.postsWeek} post${s.postsWeek > 1 ? "s" : ""} · ${fmt(s.engagementWeek)} interactions`, `Posts ${trend(s.postsWeek, s.postsPrev)} and engagement ${trend(s.engagementWeek, s.engagementPrev)} vs the week before.`);
  const k = kpis([
    { label: "Posts", value: fmt(s.postsWeek), hint: `last week ${s.postsPrev}`, level: lvl },
    { label: "LinkedIn / X", value: `${s.linkedinWeek} / ${s.xWeek}` },
    { label: "Engagement", value: fmt(s.engagementWeek), hint: `last week ${fmt(s.engagementPrev)}` },
    { label: "Per post", value: fmt(s.avgEngagement), hint: `${s.activeDays} active day${s.activeDays === 1 ? "" : "s"}` },
  ]);
  const max = Math.max(1, ...s.topics.map((t) => t.count));
  const topics = s.topics.length
    ? table(`<tr><th ${TH}>Topic</th><th ${THR}>Posts</th><th ${TH}></th></tr>`, s.topics.map((t) => `<tr><td ${TD}>${esc(t.label)}</td><td ${TDR}>${t.count} · ${t.share}%</td><td ${TD}>${bar(t.count, max, RED)}</td></tr>`).join(""))
    : "";
  const reactions = `<div style="font-size:13px;line-height:1.7;">${fmt(s.likes)} likes · ${fmt(s.comments)} comments · ${fmt(s.shares)} shares · ${s.mediaShare}% of posts with an image or video</div>`;
  const body =
    head +
    k +
    (s.postsWeek
      ? section("What the posts were about", topics + `<div style="margin-top:10px;">${chips(s.hashtags, "#")}</div>`, "Rule-based topics on the text of each post.") +
        section("Audience response", reactions) +
        section("Best posts of the week", postList(s.topPosts, false), "Ranked by engagement.")
      : "");
  return shell("company", d, body);
}

// ── Competitive ─────────────────────────────────────────────────────────────

export function renderCompetitive(d: FridayData): string {
  if (!d.competitors.length) {
    return shell(
      "competitive",
      d,
      banner("warn", "No competitor linked to this client yet", `Add 3 or more competitors in the Competitor Watch tab of <a href="${clientUrl(d.client.id)}" style="color:${RED};">${esc(d.client.name)}</a> — their posts are then collected and compared here every Friday.`),
    );
  }
  const c = d.comparison;
  const me = c.shareOfVoice.find((x) => x.role === "self")!;
  const n = d.competitors.length + 1;
  const lvl: Level = c.rankByEngagement === 1 ? "ok" : c.rankByEngagement <= Math.ceil(n / 2) ? "warn" : "critical";
  const head = banner(lvl, `${d.client.name} ranks #${c.rankByEngagement} of ${n} on engagement, #${c.rankByPosts} on posts`, `${me.postShare}% of the posts and ${me.engagementShare}% of the engagement published this week by ${d.client.name} and its ${d.competitors.length} competitor${d.competitors.length > 1 ? "s" : ""}.`);
  const maxEng = Math.max(1, ...c.shareOfVoice.map((x) => x.engagement));
  const all = [d.self, ...d.competitors];
  const byId = new Map(all.map((x) => [x.id, x]));
  const sov = table(
    `<tr><th ${TH}>Company</th><th ${THR}>Posts</th><th ${THR}>vs last wk</th><th ${THR}>Engagement</th><th ${TH}></th><th ${TH}>Main topic</th></tr>`,
    c.shareOfVoice
      .map((x) => {
        const st = byId.get(x.id)!;
        const self = x.role === "self";
        return `<tr${self ? ` style="background:#fdf2f2;"` : ""}><td ${TD}><a href="${clientUrl(x.id)}" style="color:${INK};${self ? "font-weight:800;" : ""}">${esc(x.name)}</a>${st.postsWeek === 0 ? ` ${pill("silent", "warn")}` : ""}</td><td ${TDR}>${x.posts}</td><td ${TDR}>${trend(st.postsWeek, st.postsPrev)}</td><td ${TDR}>${fmt(x.engagement)} · ${x.engagementShare}%</td><td ${TD}>${bar(x.engagement, maxEng, self ? RED : "#9ca3af")}</td><td ${TD} style="font-size:12px;">${esc(st.mainTopic || "—")}</td></tr>`;
      })
      .join(""),
  );
  const mix = c.topicMix.length
    ? table(`<tr><th ${TH}>Topic</th><th ${THR}>${esc(d.client.name)}</th><th ${THR}>Competitors (avg)</th></tr>`, c.topicMix.slice(0, 9).map((t) => `<tr><td ${TD}>${esc(t.label)}</td><td ${TDR}>${t.self}%</td><td ${TDR}>${t.competitors}%</td></tr>`).join(""))
    : "";
  const words = `<div style="font-size:12px;color:${GREY};margin-bottom:4px;">Used by competitors, not by ${esc(d.client.name)}:</div>${chips(c.gaps.map((g) => ({ term: g.term, count: g.competitors })))}
    <div style="font-size:12px;color:${GREY};margin:10px 0 4px;">Owned by ${esc(d.client.name)} (no competitor used them):</div>${chips(c.owned)}`;
  const compPosts = d.weekPosts.filter((p) => p.role === "competitor").slice(0, 6);
  const body =
    head +
    section("Share of voice this week", sov) +
    section("Topic mix", mix, "Share of each company's posts, rule-based topics.") +
    section("Key words", words, "Number = how many competitors used the word this week.") +
    section("Competitor posts that worked best", postList(compPosts, true));
  return shell("competitive", d, body);
}

// ── Intelligence ────────────────────────────────────────────────────────────

const PRIO: Record<string, Level> = { high: "critical", medium: "warn", low: "ok" };

export function renderIntelligence(d: FridayData, r: IntelResult): string {
  const i = r.intel;
  const based = (t: string) => (t ? `<div style="font-size:11px;color:${GREY};margin-top:4px;"><b>Based on:</b> ${esc(t)}</div>` : "");
  const insights = i.insights.length
    ? i.insights.map((x) => `<div style="padding:9px 0;border-bottom:1px solid #f1f1f1;"><div style="font-size:14px;font-weight:700;">${esc(x.title)}</div><div style="font-size:13px;line-height:1.5;margin-top:3px;">${esc(x.detail)}</div>${based(x.basedOn)}</div>`).join("")
    : `<div style="font-size:13px;color:${GREY};">Not enough data this week.</div>`;
  const actions = i.actions.length
    ? i.actions
        .map(
          (x) => `<div style="padding:9px 0;border-bottom:1px solid #f1f1f1;"><div>${pill(x.priority, PRIO[x.priority] || "warn")} <span style="font-size:11px;font-weight:700;color:${GREY};text-transform:uppercase;">${esc(x.pillar)}</span></div>
          <div style="font-size:14px;font-weight:700;margin-top:4px;">${esc(x.action)}</div><div style="font-size:13px;line-height:1.5;margin-top:2px;">${esc(x.why)}</div>${based(x.basedOn)}
          ${x.url ? `<div style="margin-top:3px;"><a href="${esc(x.url)}" style="font-size:12px;color:${RED};font-weight:700;text-decoration:none;">Open the post →</a></div>` : ""}</div>`,
        )
        .join("")
    : `<div style="font-size:13px;color:${GREY};">No action this week.</div>`;
  const ideas = i.postIdeas.map((x) => `<div style="padding:8px 0;border-bottom:1px solid #f1f1f1;"><div style="font-size:14px;font-weight:700;">“${esc(x.hook)}”</div><div style="font-size:13px;margin-top:2px;">${esc(x.angle)}</div>${based(x.basedOn)}</div>`).join("");
  const watch = i.watch.map((x) => `<li style="margin:4px 0;font-size:13px;"><b>${esc(x.company)}</b> — ${esc(x.signal)}</li>`).join("");
  const s = d.self;
  const data = kpis([
    { label: `${s.name} posts`, value: fmt(s.postsWeek), hint: trend(s.postsWeek, s.postsPrev) + " vs last week" },
    { label: "Engagement", value: fmt(s.engagementWeek), hint: trend(s.engagementWeek, s.engagementPrev) + " vs last week" },
    { label: "Competitors tracked", value: String(d.competitors.length), hint: `${d.competitors.reduce((a, c) => a + c.postsWeek, 0)} posts this week` },
    { label: "Engagement rank", value: d.competitors.length ? `#${d.comparison.rankByEngagement}/${d.competitors.length + 1}` : "—" },
  ]);
  const body =
    `<div style="padding:18px 24px;border-bottom:1px solid #eee;border-left:4px solid ${RED};"><div style="font-size:18px;font-weight:800;line-height:1.35;">${esc(i.headline || "This week's intelligence")}</div></div>` +
    data +
    section("Insights", insights) +
    section("Actions for next week", actions) +
    (ideas ? section("Post ideas", ideas) : "") +
    (watch ? section("Competitors to watch", `<ul style="margin:0;padding-left:18px;">${watch}</ul>`) : "") +
    `<div style="padding:12px 24px;font-size:11px;color:#9ca3af;border-bottom:1px solid #eee;">${r.ai ? `Written by Intelligence (Cloudflare Workers AI · ${esc(r.model || "")}) from the numbers of this week's Company and Competitive reports and the collected posts. Check before sharing with the client.` : esc(r.note || "Rule-based insights — Intelligence was not available.")}</div>`;
  return shell("intelligence", d, body);
}
