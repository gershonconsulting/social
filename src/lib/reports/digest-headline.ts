/**
 * Daily digest headline + subject (v4.80.2, nightly 2026-11-20). Pure, no DB.
 *
 * Before this, a day where the collector did not run (or ran and stored
 * nothing) produced the same digest as a quiet day: a big "0", "0 posts from
 * 0 companies" in the subject. On 11-13, 11-14, 11-15 and 11-18 that was the
 * headline while a separate "NO COLLECTION" mail said the opposite.
 *
 * The verdict uses the same rule as the Collection Report's run status
 * (daily-report.ts): the ingest heartbeat separates "did not run" from
 * "ran but stored nothing". The digest is internal-only (report@ + aina@).
 */

export interface HeartbeatDayLite {
  runs: number;
  attempted: number;
  upserted: number;
  failed: number;
}

export interface Reason {
  reason: string;
  n: number;
}

export interface DigestHealthInput {
  /** "November 18, 2026" — the ET day the digest counts. */
  dayShort: string;
  posts: number;
  companies: number;
  /** Heartbeat entry for that ET day; null = no run reached the server. */
  heartbeat: HeartbeatDayLite | null;
  /** Most common current sync-error reasons (already grouped, any order). */
  failureReasons: Reason[];
}

export interface DigestHeadline {
  noCollection: boolean;
  cause: "did-not-run" | "failed" | null;
  /** Short reason in brackets after "0 posts". */
  reason: string;
  /** Headline line shown at the top of the digest. */
  headline: string;
  /** Full subject, given the normal "<Title> — <Workspace> — <day>" base. */
  subject: (base: string) => string;
}

export function topReasons(reasons: Reason[], k = 3): Reason[] {
  return [...reasons]
    .filter((r) => r.n > 0 && r.reason.trim())
    .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
    .slice(0, k);
}

/** Group raw error strings into reasons (trimmed, first 90 chars, case-insensitive). */
export function groupReasons(raw: Array<string | null | undefined>): Reason[] {
  const m = new Map<string, Reason>();
  for (const r of raw) {
    const t = (r ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
    if (!t) continue;
    const k = t.toLowerCase();
    const cur = m.get(k);
    if (cur) cur.n++;
    else m.set(k, { reason: t, n: 1 });
  }
  return [...m.values()];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function digestHeadline(i: DigestHealthInput): DigestHeadline {
  const pc = `${plural(i.posts, "post", "posts")} from ${plural(i.companies, "company", "companies")}`;
  if (i.posts > 0) {
    return {
      noCollection: false,
      cause: null,
      reason: "",
      headline: `${plural(i.posts, "post", "posts")} collected on ${i.dayShort} across ${plural(i.companies, "company", "companies")}`,
      subject: (base) => `${base} — ${pc}`,
    };
  }
  const ran = !!i.heartbeat && i.heartbeat.runs > 0;
  let reason: string;
  if (!ran) {
    reason = "collector did not run: no collection run reached the server";
  } else {
    const hb = i.heartbeat!;
    const top = topReasons(i.failureReasons, 1)[0];
    reason =
      `collector failed: ${plural(hb.runs, "run", "runs")}, ${plural(hb.failed, "failed attempt", "failed attempts")}, 0 stored` +
      (top ? `; top error: ${top.reason}` : "");
  }
  const headline = `⚠ No collection on ${i.dayShort} — 0 posts (${reason})`;
  return {
    noCollection: true,
    cause: ran ? "failed" : "did-not-run",
    reason,
    headline,
    // Subject keeps the base so mail filters still match; warning goes first.
    subject: (base) => `⚠ No collection on ${i.dayShort} — 0 posts (${ran ? "collector failed" : "collector did not run"}) — ${base}`,
  };
}
