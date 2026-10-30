/**
 * Pure (no DB, no imports) headline / tile / subject numbers for the
 * Social Posting Report — v4.67.2.
 *
 * Before: the headline said "3 of 11 companies did NOT post" (missed / due)
 * while the tiles said "Posted 9/12" (anyone who posted / all companies) and
 * "Missed 3" — two denominators in one e-mail. Now every "yesterday" number
 * uses the same denominator: the companies that were DUE that day. Companies
 * that posted while not due are shown as a "+N not due" hint, never mixed in.
 */

export type PostingDayInput = { expected: boolean; count: number };

export type PostingYesterdayCounts = {
  /** Companies in the report. */
  companies: number;
  /** Companies a post was due from on the day (the one denominator). */
  due: number;
  /** Due companies that posted. */
  postedDue: number;
  /** Due companies that did not post. postedDue + missed === due. */
  missed: number;
  /** Companies that posted although no post was due (bonus, not in the ratio). */
  postedNotDue: number;
  /** Every company that posted (postedDue + postedNotDue). */
  posted: number;
};

export function yesterdayCounts(rows: Array<{ yesterday: PostingDayInput }>): PostingYesterdayCounts {
  const due = rows.filter((r) => r.yesterday.expected);
  const postedDue = due.filter((r) => r.yesterday.count > 0).length;
  const postedNotDue = rows.filter((r) => !r.yesterday.expected && r.yesterday.count > 0).length;
  return {
    companies: rows.length,
    due: due.length,
    postedDue,
    missed: due.length - postedDue,
    postedNotDue,
    posted: postedDue + postedNotDue,
  };
}

export type PostingSummary = {
  headline: string;
  posted: { label: string; value: string; hint?: string };
  missed: { label: string; value: string };
  subjectTail: string;
};

/** dayShort e.g. "Wed, Oct 29, 2026"; dayLabel e.g. "Wed, Oct 29". */
export function postingSummary(c: PostingYesterdayCounts, dayShort: string): PostingSummary {
  const dayLabel = dayShort.replace(/, \d{4}$/, "");
  const extra = c.postedNotDue ? `+${c.postedNotDue} posted while not due` : undefined;
  if (!c.due) {
    return {
      headline: `${dayShort} was not a posting day — ${c.posted} of ${c.companies} companies posted anyway`,
      posted: { label: `Posted ${dayLabel} (none due)`, value: `${c.posted}/${c.companies}` },
      missed: { label: "Missed (of 0 due)", value: "0/0" },
      subjectTail: `not a posting day, ${c.posted}/${c.companies} posted anyway`,
    };
  }
  return {
    headline: c.missed
      ? `${c.missed} of ${c.due} companies due on ${dayShort} did NOT post`
      : `All ${c.due} companies due on ${dayShort} posted`,
    posted: { label: `Posted ${dayLabel} (of due)`, value: `${c.postedDue}/${c.due}`, hint: extra },
    missed: { label: "Missed (of due)", value: `${c.missed}/${c.due}` },
    subjectTail: c.missed
      ? `${c.missed} of ${c.due} due ${c.missed === 1 ? "company" : "companies"} did not post`
      : `${c.postedDue}/${c.due} due posted`,
  };
}
