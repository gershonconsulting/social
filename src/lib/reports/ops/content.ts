/**
 * Report 3 — CONTENT READY: how much approved content is waiting to be
 * published, for every campaign / internal company.
 *
 * Built on the same inventory the Publishing board uses
 * (lib/publishing-inventory.ts), so the email and the board can never
 * disagree. Rule (Olivier, 2026-10-11): always one week of approved content
 * in the library per company.
 */
import { inventory, TARGET_DAYS, type InventoryRow } from "@/lib/publishing-inventory";
import { etDayKey, etDayShort } from "../et-days";
import { banner, esc, kpis, page, pill, section, SITE, table, TD, TDR, TH, THR, type Level } from "./shell";

export type ContentReport = {
  dayKey: string;
  dayShort: string;
  rows: InventoryRow[];
  totals: { companies: number; ready: number; ok: number; low: number; critical: number; drafts: number; inReview: number; changes: number; missing: number };
  level: Level;
};

export async function buildContentReport(orgId: string, now = new Date()): Promise<ContentReport> {
  const rows = await inventory(orgId, now.getTime());
  const sum = (f: (r: InventoryRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const totals = {
    companies: rows.length,
    ready: sum((r) => r.ready),
    ok: rows.filter((r) => r.level === "ok").length,
    low: rows.filter((r) => r.level === "low").length,
    critical: rows.filter((r) => r.level === "critical").length,
    drafts: sum((r) => r.drafts),
    inReview: sum((r) => r.inReview),
    changes: sum((r) => r.changesRequested),
    missing: sum((r) => r.missing),
  };
  const level: Level = totals.critical ? "critical" : totals.low ? "warn" : "ok";
  // Reported "as of this morning": the day key is today's, the label is today.
  return { dayKey: etDayKey(0, now), dayShort: etDayShort(0, now), rows, totals, level };
}

const LVL: Record<InventoryRow["level"], Level> = { ok: "ok", low: "warn", critical: "critical" };

function runsOut(r: InventoryRow): string {
  if (!r.runsOutOn) return `<span style="color:#b91c1c;font-weight:700;">empty now</span>`;
  return esc(new Date(r.runsOutOn).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }));
}

export function renderContent(r: ContentReport): string {
  const t = r.totals;
  const head = banner(
    r.level,
    t.critical
      ? `${t.critical} of ${t.companies} companies have less than half a week of content ready`
      : t.low
        ? `${t.low} of ${t.companies} companies are under one week of content`
        : `Every company has at least one week of approved content`,
    `${t.ready} approved posts are ready to publish across ${t.companies} companies. ${t.missing ? `<b>${t.missing}</b> more approved posts are needed to give every company a full week.` : ""}`,
  );

  const grid = table(
    `<tr><th ${TH}>Company</th><th ${THR}>Ready</th><th ${THR}>Covers</th><th ${TH}>Runs out</th><th ${THR}>Drafts</th><th ${THR}>With client</th><th ${THR}>Changes</th></tr>`,
    r.rows
      .map(
        (x) => `<tr>
      <td ${TD}><a href="${SITE}/clients/${x.clientId}" style="color:#111;font-weight:700;text-decoration:none;">${esc(x.name)}</a>
        <div style="font-size:11px;color:#9ca3af;">${x.clientType === "INTERNAL" ? "Internal" : "Campaign"} · ${x.perWeek}/week${x.missing ? ` · <b style="color:#b91c1c;">${x.missing} more needed</b>` : ""}</div></td>
      <td ${TDR}><b>${x.ready}</b><div style="font-size:11px;color:#9ca3af;">${x.scheduled} scheduled</div></td>
      <td ${TDR}>${pill(`${x.coverageDays} of ${TARGET_DAYS} days`, LVL[x.level])}</td>
      <td ${TD}>${runsOut(x)}</td>
      <td ${TDR}>${x.drafts || "—"}</td>
      <td ${TDR}>${x.inReview ? `${x.inReview}${x.overdueReviews ? `<div style="font-size:11px;color:#b45309;">${x.oldestReviewDays}d waiting</div>` : ""}` : "—"}</td>
      <td ${TDR}>${x.changesRequested ? `<span style="color:${x.overdueChanges ? "#b91c1c" : "#111"};">${x.changesRequested}</span>` : "—"}</td>
    </tr>`,
      )
      .join(""),
  );

  const body =
    head +
    kpis([
      { label: "Approved posts ready", value: String(t.ready) },
      { label: "Full week covered", value: `${t.ok}/${t.companies}`, level: t.ok === t.companies ? "ok" : "warn" },
      { label: "Under half a week", value: String(t.critical), level: t.critical ? "critical" : "ok" },
      { label: "Waiting for client", value: String(t.inReview), hint: `${t.changes} with changes asked`, level: t.inReview ? "warn" : "ok" },
    ]) +
    section(
      "Content ready, company by company",
      grid,
      `Ready = approved and not yet published. Covers = ready ÷ the company's posts-per-week target. Target: ${TARGET_DAYS} days.`,
    );

  return page({
    kind: "content",
    title: "Social Content Ready Report",
    subtitle: `How much content is ready to publish — as of ${r.dayShort}`,
    body,
    cta: { href: `${SITE}/publishing`, label: "Open the content library" },
  });
}

export function contentSubject(r: ContentReport): string {
  const t = r.totals;
  const base = `Social Content Ready Report — ${r.dayShort}`;
  if (t.critical) return `⛔ ${base} — ${t.critical} ${t.critical === 1 ? "company" : "companies"} under half a week`;
  if (t.low) return `⚠️ ${base} — ${t.low} under one week`;
  return `${base} — ${t.ready} posts ready, every company covered`;
}
