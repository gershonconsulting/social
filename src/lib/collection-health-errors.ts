/** Pure helpers for the LinkedIn collection alarm (no DB import, so tests can load them). */

/**
 * Errors that come from the BROWSER, not from LinkedIn: the collector's tab was
 * closed or its page could not be scripted. They say nothing about whether
 * LinkedIn changed its pages, so they stay out of the alarm (2026-11-25: one
 * closed tab at 16:04 UTC put all 13 companies at "0 posts" and the red strip
 * blamed LinkedIn). Dead links (PAGE_UNAVAILABLE) are excluded the same way.
 */
export function isBrowserSideError(err: string | null | undefined): boolean {
  if (!err) return false;
  return /^(tabs\.update failed|executeScript:|no scrape result)/i.test(err)
    || /No tab with id|Frame with ID \d+ was removed|Cannot access contents of the page/i.test(err);
}

/** Should this LinkedIn result count toward the "LinkedIn changed" alarm? */
export function countsForLinkedInAlarm(err: string | null | undefined): boolean {
  if (!err) return true;
  if (err.startsWith("PAGE_UNAVAILABLE")) return false;
  return !isBrowserSideError(err);
}
