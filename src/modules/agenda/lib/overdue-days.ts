/**
 * Overdue-days helper — pure module.
 *
 * Computes how many full days have elapsed between a session's start and a
 * reference `now`. This is a DURATION-based measure (raw elapsed milliseconds
 * floored to whole days), NOT a São Paulo calendar-day difference — so it is
 * immune to timezone/midnight-boundary flakiness (design D2). `now` is injected
 * to keep the function deterministic and testable.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Returns the number of full days elapsed since `startAt` relative to `now`.
 *
 * `Math.floor((now − startAt) / MS_PER_DAY)`. A session in the future yields a
 * negative value; callers that only care about overdue sessions should treat
 * non-positive results as "not overdue".
 */
export function overdueDays(startAt: Date, now: Date): number {
  return Math.floor((now.getTime() - startAt.getTime()) / MS_PER_DAY);
}
