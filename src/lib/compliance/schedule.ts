/**
 * Posting schedule helpers — determines which days a client is expected to post
 * on a given platform, respecting the configured posting mode, weekday rules,
 * holiday calendar, and exclusion dates.
 */

import { PostingSchedule, PostingMode } from "@prisma/client";
import { eachDayOfInterval, isWeekend, parseISO, format, startOfMonth, endOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Returns the list of expected posting dates (as YYYY-MM-DD strings)
 * within the given UTC date range, computed in the client's timezone.
 */
export function getExpectedPostingDates(
  schedule: PostingSchedule,
  rangeStart: Date,
  rangeEnd: Date,
  timezone: string
): string[] {
  // Convert range boundaries to local timezone date strings
  const localStart = toZonedTime(rangeStart, timezone);
  const localEnd = toZonedTime(rangeEnd, timezone);

  const allDays = eachDayOfInterval({ start: localStart, end: localEnd });

  const exclusionDates = parseJsonDates(schedule.exclusionDatesJson);
  const holidayDates = parseJsonDates(schedule.holidayCalendarJson);
  const blockedDates = new Set([...exclusionDates, ...holidayDates]);

  const customWeekdays = parseJsonArray<number>(schedule.weekdaysJson);

  return allDays
    .filter((day) => {
      const dateStr = format(day, "yyyy-MM-dd");

      // Never post on blocked dates
      if (blockedDates.has(dateStr)) return false;

      return isDayExpected(schedule.mode, day, customWeekdays);
    })
    .map((day) => format(day, "yyyy-MM-dd"));
}

/**
 * For a single date (local), determine if posting is expected.
 */
export function isDayExpected(
  mode: PostingMode,
  localDay: Date,
  customWeekdays: number[]
): boolean {
  switch (mode) {
    case PostingMode.EVERY_DAY:
      return true;

    case PostingMode.WORKING_DAYS:
      return !isWeekend(localDay);

    case PostingMode.CUSTOM_WEEKDAYS: {
      const dayOfWeek = localDay.getDay(); // 0 = Sun
      return customWeekdays.includes(dayOfWeek);
    }

    case PostingMode.CUSTOM_TARGET:
      // Custom target count mode: expect every working day for day-level computation.
      // Monthly completion uses the target count instead of day-level matching.
      return !isWeekend(localDay);

    default:
      return false;
  }
}

/**
 * Get all expected posting dates for a full month.
 */
export function getExpectedDatesForMonth(
  schedule: PostingSchedule,
  year: number,
  month: number, // 1-indexed
  timezone: string
): string[] {
  // Build month boundaries in UTC (start of first day, end of last day)
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  return getExpectedPostingDates(schedule, monthStart, monthEnd, timezone);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonDates(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonArray<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
