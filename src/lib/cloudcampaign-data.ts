// Cloud Campaign content snapshot — by client, by month.
// Pulled from the Cloud Campaign REST API (workspace calendar + content-detail
// endpoints). This is a periodic SNAPSHOT, not a live feed: the CRM origin can't
// call the Cloud Campaign API directly (cookie auth + CORS), so this file is
// regenerated and committed on a schedule. May/Jun/Jul 2026 reflect the latest
// clean pull; older months come from the full-history pull.

export type Funnel = [created: number, validated: number, published: number, scheduled: number];

export const SNAPSHOT_AT = "2026-06-28T14:30:00Z";

// workspaceName -> { 'YYYY-MM': [created, validated, published, scheduled] }
export const MONTHLY: Record<string, Record<string, Funnel>> = {
  "Valos": {
    "2025-04": [3, 3, 0, 0], "2025-05": [15, 15, 0, 0], "2025-06": [16, 11, 13, 0],
    "2025-07": [14, 19, 18, 0], "2025-08": [12, 12, 14, 0], "2025-09": [10, 10, 13, 0],
    "2025-10": [12, 12, 11, 0], "2025-11": [15, 15, 12, 0], "2025-12": [12, 12, 13, 0],
    "2026-01": [15, 2, 13, 0], "2026-02": [10, 23, 13, 0], "2026-03": [14, 13, 12, 0],
    "2026-04": [8, 5, 12, 0], "2026-05": [12, 5, 12, 0], "2026-06": [0, 12, 6, 1],
    "2026-07": [0, 0, 0, 8],
  },
  "Wallix": {
    "2025-09": [6, 0, 0, 0], "2025-11": [8, 0, 0, 0], "2025-12": [0, 14, 0, 0],
    "2026-01": [10, 0, 7, 0], "2026-02": [12, 20, 12, 0], "2026-03": [11, 2, 14, 0],
    "2026-04": [2, 11, 10, 0], "2026-05": [5, 11, 6, 0], "2026-06": [0, 2, 11, 0],
  },
  "Urban Factory": {
    "2026-01": [4, 0, 0, 0], "2026-02": [12, 16, 5, 0], "2026-03": [6, 0, 11, 0],
    "2026-04": [6, 6, 3, 0], "2026-05": [5, 7, 9, 0], "2026-06": [0, 5, 6, 0],
  },
  "Edflex": {
    "2026-02": [3, 0, 0, 0], "2026-03": [0, 3, 3, 0],
  },
  "ENZYMICALS AG": {
    "2026-06": [5, 5, 0, 0], "2026-07": [0, 0, 0, 5],
  },
  "Narratio AI Solutions": {
    "2026-04": [3, 0, 0, 0], "2026-05": [0, 4, 4, 0],
  },
  "PhiTech Inc.": {},
  "ACG Cybersecurity": {},
};

export const ACTIVE: Record<string, boolean> = {
  "Valos": true, "Wallix": true, "Urban Factory": true, "Edflex": true,
  "ENZYMICALS AG": true, "Narratio AI Solutions": false, "PhiTech Inc.": true,
  "ACG Cybersecurity": false,
};

// Descriptive stats from the full-history pull (253 posts).
export const LAG = { same: 1, d1_7: 10, d8_30: 202, d31_60: 34, d60p: 6 };
export const APPROVAL_SRC = { Client: 252, Internal: 1 };
export const PLATFORM = { LINKEDIN: 253 };

// Months that are not yet complete (current month, month-to-date).
export const PARTIAL_MONTHS = ["2026-06"];
// Months that only contain future-scheduled posts.
export const FUTURE_MONTHS = ["2026-07"];

export const FUNNEL_COLORS = { created: "#6366f1", validated: "#10b981", published: "#f59e0b", scheduled: "#a9afc7" };

export type MonthRow = { month: string; created: number; validated: number; published: number; scheduled: number };

export function allMonths(): string[] {
  const s = new Set<string>();
  Object.values(MONTHLY).forEach((o) => Object.keys(o).forEach((m) => s.add(m)));
  return [...s].sort();
}

export function overallByMonth(workspace?: string): MonthRow[] {
  const months = allMonths();
  const names = workspace && workspace !== "__all__" ? [workspace] : Object.keys(MONTHLY);
  return months.map((m) => {
    let c = 0, v = 0, p = 0, sc = 0;
    names.forEach((w) => { const r = MONTHLY[w]?.[m]; if (r) { c += r[0]; v += r[1]; p += r[2]; sc += r[3]; } });
    return { month: m, created: c, validated: v, published: p, scheduled: sc };
  });
}

export function clientMonth(workspace: string, month: string): Funnel {
  return MONTHLY[workspace]?.[month] ?? [0, 0, 0, 0];
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "short" }) + " '" + String(y).slice(2);
}

// ---- Output vs target (1 post per working day) ----

// Working days (Mon–Fri) in a month. For the month we are actually in right
// now, only days up to today are counted, giving a fair pace-to-date read.
// Everything here works in UTC so a server render and a client render of the
// same instant agree (no hydration mismatch across timezones).
export function workingDays(ym: string, now: Date = new Date()): { target: number; current: boolean } {
  const [y, m] = ym.split("-").map(Number);
  const current = y === now.getUTCFullYear() && m - 1 === now.getUTCMonth();
  let n = 0;
  const d = new Date(Date.UTC(y, m - 1, 1));
  while (d.getUTCMonth() === m - 1) {
    const dow = d.getUTCDay();
    const elapsed = !current || d.getUTCDate() <= now.getUTCDate();
    if (dow >= 1 && dow <= 5 && elapsed) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { target: n, current };
}

// Posting cadence target per client, in posts per week. Default is one post per
// working day (5/week). Override per client here.
export const CADENCE_PER_WEEK: Record<string, number> = {
  "Wallix": 3,
};
export const DEFAULT_CADENCE_PER_WEEK = 5; // one post per working day

export function cadence(workspace: string): number {
  return CADENCE_PER_WEEK[workspace] ?? DEFAULT_CADENCE_PER_WEEK;
}

export function cadenceLabel(workspace: string): string {
  const c = cadence(workspace);
  return c === 5 ? "1 / working day" : `${c} / week`;
}

// Target number of POSTS for a client in a month, derived from its weekly cadence
// scaled by working days (so a 5/week client's target equals the working days,
// preserving the original one-a-day behaviour). Current month uses days elapsed.
export function postTarget(workspace: string, ym: string, now: Date = new Date()): { target: number; current: boolean } {
  const { target: wd, current } = workingDays(ym, now);
  const t = Math.round((cadence(workspace) / 5) * wd);
  return { target: Math.max(t, 0), current };
}

// "last month" / "this month" / "next month" relative to TODAY (not to the
// snapshot). The page is read as a live operating view, so the three blocks
// must always mean the real last / current / next calendar month; if the
// snapshot hasn't been refreshed, the blocks come up empty and the staleness
// banner (see snapshotAgeDays) says why.
export function focusMonths(now: Date = new Date()): { lastM: string; thisM: string; nextM: string } {
  const d = now;
  const key = (yy: number, mm: number) => {
    const dt = new Date(Date.UTC(yy, mm, 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return {
    lastM: key(d.getUTCFullYear(), d.getUTCMonth() - 1),
    thisM: key(d.getUTCFullYear(), d.getUTCMonth()),
    nextM: key(d.getUTCFullYear(), d.getUTCMonth() + 1),
  };
}

// A month entirely in the future relative to today.
export function isFutureMonth(ym: string, now: Date = new Date()): boolean {
  const cur = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const [y, m] = ym.split("-").map(Number);
  return (y * 12 + (m - 1)) > cur;
}

// ---- Snapshot freshness ----

/** Whole days between the committed snapshot and now. */
export function snapshotAgeDays(now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(SNAPSHOT_AT).getTime()) / 86400000));
}

/** The last month the snapshot can actually speak for ("YYYY-MM"). */
export function snapshotMonth(): string {
  const d = new Date(SNAPSHOT_AT);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** True when a focus month starts after the snapshot was taken — i.e. the
 *  snapshot simply has no data for it, which is different from "zero posts". */
export function beyondSnapshot(ym: string): boolean {
  const d = new Date(SNAPSHOT_AT);
  const snap = d.getUTCFullYear() * 12 + d.getUTCMonth();
  const [y, m] = ym.split("-").map(Number);
  return (y * 12 + (m - 1)) > snap;
}

/** Anything older than this and the page shouts. */
export const SNAPSHOT_STALE_DAYS = 10;
