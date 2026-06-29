// HeroPost content snapshot — by client (workspace), by month.
// Pulled from the HeroPost GraphQL API (api.heropost.io/graphql, customPosts per
// workspaceId). Periodic SNAPSHOT, not live: the CRM origin can't call HeroPost
// directly (token auth + CORS), so this file is regenerated and committed.
// HeroPost has no created/validated approval workflow like Cloud Campaign, so the
// funnel is created (all content for the month) -> published, plus scheduled-ahead.

export type Funnel = [created: number, published: number, scheduled: number];

export const SNAPSHOT_AT = "2026-06-28T14:30:00Z";

// workspaceName -> { 'YYYY-MM': [created, published, scheduled] }
// created = published + scheduled + draft for that month.
export const MONTHLY: Record<string, Record<string, Funnel>> = {
  "Gershon Consulting": { "2026-05": [16, 15, 0], "2026-06": [15, 15, 0], "2026-07": [15, 0, 15] },
  "Wallix": { "2026-05": [7, 7, 0], "2026-06": [11, 11, 0] },
  "Linalysis": { "2026-06": [12, 11, 1], "2026-07": [12, 0, 12] },
  "Valos": { "2026-05": [12, 12, 0], "2026-06": [7, 6, 1], "2026-07": [8, 0, 7] },
  "Urban Factory": { "2026-05": [9, 9, 0], "2026-06": [6, 6, 0] },
  "Narratio AI": { "2026-05": [4, 4, 0] },
  "EDFLEX North America": {},
  "Puente Latin": {},
  "My Workspace": {},
};

export const FUNNEL_COLORS = { created: "#6366f1", validated: "#0ea5e9", scheduled: "#f59e0b", published: "#10b981" };

export function clientMonth(workspace: string, month: string): Funnel {
  return MONTHLY[workspace]?.[month] ?? [0, 0, 0];
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en", { month: "short" }) + " '" + String(y).slice(2);
}

export function workingDays(ym: string): { target: number; current: boolean } {
  const snap = new Date(SNAPSHOT_AT);
  const [y, m] = ym.split("-").map(Number);
  const current = y === snap.getUTCFullYear() && m - 1 === snap.getUTCMonth();
  let n = 0;
  const d = new Date(Date.UTC(y, m - 1, 1));
  while (d.getUTCMonth() === m - 1) {
    const dow = d.getUTCDay();
    const elapsed = !current || d.getUTCDate() <= snap.getUTCDate();
    if (dow >= 1 && dow <= 5 && elapsed) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { target: n, current };
}

export function focusMonths(): { lastM: string; thisM: string; nextM: string } {
  const d = new Date(SNAPSHOT_AT);
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

export function isFutureMonth(ym: string): boolean {
  const d = new Date(SNAPSHOT_AT);
  const cur = d.getUTCFullYear() * 12 + d.getUTCMonth();
  const [y, m] = ym.split("-").map(Number);
  return (y * 12 + (m - 1)) > cur;
}

// Per-client posting cadence. Default cadence is 1 published post per working day
// (~5/week) and uses workingDays() as the target. Clients listed here instead use
// a fixed weekly cadence (posts per week).
export const WEEKLY_CADENCE: Record<string, number> = {
  "Wallix": 3,
};

// Target for a weekly-cadence client: perWeek x weeks in the period. The current
// (snapshot) month counts only elapsed days, for a fair pace-to-date read.
export function weeklyTarget(ym: string, perWeek: number): { target: number; current: boolean } {
  const snap = new Date(SNAPSHOT_AT);
  const [y, m] = ym.split("-").map(Number);
  const current = y === snap.getUTCFullYear() && m - 1 === snap.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = current ? snap.getUTCDate() : daysInMonth;
  return { target: Math.max(1, Math.round((days / 7) * perWeek)), current };
}

// Resolve the right target for a client in a month: weekly cadence if set,
// otherwise the default 1-per-working-day target.
export function clientTarget(name: string, ym: string): { target: number; current: boolean; perWeek?: number } {
  const pw = WEEKLY_CADENCE[name];
  if (pw) return { ...weeklyTarget(ym, pw), perWeek: pw };
  return workingDays(ym);
}
