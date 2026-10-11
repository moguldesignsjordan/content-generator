import type { Cadence } from "@/lib/db/types";

// Pure, deliberately free of the "server-only" import chain (mirrors
// lib/keyword/normalize.ts) so it's directly unit-testable. Day-based
// approximation, not calendar-aware (monthly = 30 days, not "same day next
// month") — simple and predictable, no new date library for one helper.
const CADENCE_DAYS: Record<Cadence, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

/** Advances `from` by one cadence interval. `from` is an ISO timestamp; the
 * result is too. */
export function computeNextRunAt(cadence: Cadence, from: string): string {
  const base = new Date(from);
  const next = new Date(base.getTime() + CADENCE_DAYS[cadence] * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

/** Days the weekly social batch posts on (UTC): Monday, Wednesday, Friday. */
export const SOCIAL_POST_WEEKDAYS = [1, 3, 5];

/** At least this many days between the batch being written and its first post,
 * so there's time to review it. */
const SOCIAL_REVIEW_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" in UTC, the date format planned_publish_at uses. */
export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The next `count` posting days that leave time to review. */
export function nextSocialPostDates(from: Date, count = SOCIAL_POST_WEEKDAYS.length): string[] {
  const dates: string[] = [];
  const day = new Date(from.getTime() + SOCIAL_REVIEW_DAYS * DAY_MS);
  while (dates.length < count) {
    if (SOCIAL_POST_WEEKDAYS.includes(day.getUTCDay())) dates.push(utcDate(day));
    day.setTime(day.getTime() + DAY_MS);
  }
  return dates;
}
