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
