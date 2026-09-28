/**
 * One verdict per company — the manager's "is this right or not" answer.
 *
 * Same rule as the Dashboard (v4.10.0), kept here so every page that shows a
 * company status agrees with it:
 *   Silent         no post in 30+ days (or never)
 *   Not collected  LinkedIn or X failed / expired on the last run
 *   Setup          no LinkedIn or X page linked at all
 *   Slowing        last post 15–30 days ago
 *   On track       everything else
 *   Paused         company is not ACTIVE — not judged
 */
export type Verdict = "silent" | "collection" | "setup" | "slowing" | "ok" | "paused";

export const VERDICT_META: Record<Verdict, { label: string; pill: string; rank: number; needsAction: boolean }> = {
  silent: { label: "Silent", pill: "bg-red-50 text-red-700", rank: 0, needsAction: true },
  collection: { label: "Not collected", pill: "bg-amber-50 text-amber-800", rank: 1, needsAction: true },
  setup: { label: "Setup needed", pill: "bg-amber-50 text-amber-800", rank: 2, needsAction: true },
  slowing: { label: "Slowing", pill: "bg-amber-50 text-amber-800", rank: 3, needsAction: true },
  ok: { label: "On track", pill: "bg-green-50 text-green-800", rank: 4, needsAction: false },
  paused: { label: "Paused", pill: "bg-gray-100 text-gray-600", rank: 5, needsAction: false },
};

export const COLLECTED_NETWORKS: Record<string, string> = { LINKEDIN: "LinkedIn", TWITTER: "X" };

export const NEVER = 999999;

export function daysSinceDate(dateLocal: string | null | undefined): number {
  if (!dateLocal) return NEVER;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - new Date(dateLocal + "T00:00:00Z").getTime()) / 86400000));
}

export function lastPostLabel(d: number): string {
  if (d >= NEVER) return "Never";
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  return `${d} days ago`;
}

export function judge(input: {
  active: boolean;
  daysSince: number;
  networks: string[];        // collected networks this company has (LINKEDIN / TWITTER)
  brokenNetworks: string[];  // of those, which failed / expired
  postsThisMonth?: number;
}): { verdict: Verdict; reason: string } {
  if (!input.active) return { verdict: "paused", reason: "Not being tracked right now." };
  if (input.networks.length === 0) {
    return { verdict: "setup", reason: "No LinkedIn or X page linked, so nothing is collected." };
  }
  if (input.daysSince > 30) {
    return {
      verdict: "silent",
      reason: input.daysSince >= NEVER ? "Has never posted." : `No post in ${input.daysSince} days.`,
    };
  }
  if (input.brokenNetworks.length) {
    const names = input.brokenNetworks.map((n) => COLLECTED_NETWORKS[n] ?? n).join(" and ");
    return { verdict: "collection", reason: `We could not read ${names} on the last run.` };
  }
  if (input.daysSince > 14) {
    return { verdict: "slowing", reason: `Last post was ${input.daysSince} days ago.` };
  }
  const n = input.postsThisMonth ?? 0;
  return { verdict: "ok", reason: `${n} post${n === 1 ? "" : "s"} this month.` };
}

/** What a manager should do about each verdict, in one sentence. */
export const NEXT_STEP: Record<Verdict, string | null> = {
  silent: "Check with the company whether it stopped posting, or whether the page link below is wrong.",
  collection: "Make sure the Chrome extension ran today and is signed in to LinkedIn and X.",
  setup: "Add the company's LinkedIn or X page under Details below.",
  slowing: "Posting is slowing down. A reminder may be needed.",
  ok: null,
  paused: null,
};
