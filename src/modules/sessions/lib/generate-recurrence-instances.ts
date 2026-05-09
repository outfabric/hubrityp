/**
 * Pure function that generates materialized session dates from a recurrence rule.
 *
 * The function returns an array of Date objects representing the start date of
 * each session instance. Time-of-day is NOT included — the caller combines
 * the generated date with the session template's time.
 *
 * Conflict detection is the caller's responsibility (per RN-03.01). This
 * function never skips dates.
 */

import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  getDay,
  isBefore,
  isSameDay,
  startOfDay,
} from 'date-fns';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard cap on materialized sessions. For indefinite recurrences, the system
 * materializes up to this many sessions within the materialization window.
 * An Inngest cron extends the series before the window is exhausted.
 */
export const MAX_MATERIALIZED_SESSIONS = 104;

/** Default materialization window for indefinite recurrences (in months). */
const DEFAULT_MATERIALIZATION_WINDOW_MONTHS = 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly' | 'custom';

export interface RecurrenceRule {
  /** How often sessions repeat. */
  frequency: RecurrenceFrequency;

  /**
   * Days of the week the recurrence applies to (0 = Sunday ... 6 = Saturday).
   * Required for `weekly` and `custom` frequencies.
   * For `monthly`, if omitted the function uses the day-of-week of `startDate`.
   */
  daysOfWeek?: number[];

  /** First date of the recurrence (inclusive). */
  startDate: Date;

  /** Last date of the recurrence (inclusive). Mutually exclusive with `occurrenceCount` / `isIndefinite`. */
  endDate?: Date;

  /** Total number of sessions to generate. Mutually exclusive with `endDate` / `isIndefinite`. */
  occurrenceCount?: number;

  /** When true, materializes up to MAX_MATERIALIZED_SESSIONS within the materialization window. */
  isIndefinite?: boolean;

  /** How many months ahead to materialize for indefinite recurrences. Default: 24. */
  materializationWindowMonths?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the last valid day of a given month for a target day-of-month.
 * E.g., day 31 in February returns Feb 28 (or 29 in leap year).
 */
function clampDayOfMonth(year: number, month: number, targetDay: number): Date {
  const lastDay = endOfMonth(new Date(year, month, 1)).getDate();
  const clampedDay = Math.min(targetDay, lastDay);
  return new Date(year, month, clampedDay);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function generateRecurrenceInstances(rule: RecurrenceRule): Date[] {
  const {
    frequency,
    daysOfWeek,
    startDate,
    endDate,
    occurrenceCount,
    isIndefinite,
    materializationWindowMonths = DEFAULT_MATERIALIZATION_WINDOW_MONTHS,
  } = rule;

  const start = startOfDay(startDate);
  const dates: Date[] = [];

  // Compute the hard boundary date for generation.
  const boundaryDate = endDate
    ? startOfDay(endDate)
    : isIndefinite
      ? startOfDay(addMonths(start, materializationWindowMonths))
      : undefined;

  // Compute the hard cap on number of instances.
  const maxInstances = occurrenceCount ?? (isIndefinite ? MAX_MATERIALIZED_SESSIONS : undefined);

  // Guard: must have at least one termination condition.
  if (!boundaryDate && maxInstances == null) {
    return [];
  }

  const shouldStop = (d: Date, count: number): boolean => {
    if (maxInstances != null && count >= maxInstances) return true;
    if (boundaryDate && isBefore(boundaryDate, d) && !isSameDay(boundaryDate, d)) return true;
    // For indefinite recurrences, both the count AND the boundary apply.
    if (isIndefinite && boundaryDate && isBefore(boundaryDate, d) && !isSameDay(boundaryDate, d))
      return true;
    return false;
  };

  switch (frequency) {
    case 'weekly':
    case 'custom': {
      // Resolve effective days (use startDate's day if not specified).
      const effectiveDays =
        daysOfWeek && daysOfWeek.length > 0
          ? [...daysOfWeek].sort((a, b) => a - b)
          : [getDay(start)];

      // Find the first week that contains the startDate, then iterate week by week.
      let currentWeekStart = startOfDay(start);

      // Generate dates for each week, advancing one week at a time.
      while (!shouldStop(currentWeekStart, dates.length)) {
        for (const day of effectiveDays) {
          if (shouldStop(currentWeekStart, dates.length)) break;

          // Calculate the target date within this week.
          const currentDayOfWeek = getDay(currentWeekStart);
          const diff = day - currentDayOfWeek;
          const candidate = addDays(currentWeekStart, diff);

          // Skip dates before the start date.
          if (isBefore(candidate, start) && !isSameDay(candidate, start)) continue;

          // Skip dates after the boundary.
          if (
            boundaryDate &&
            isBefore(boundaryDate, candidate) &&
            !isSameDay(boundaryDate, candidate)
          )
            continue;

          dates.push(startOfDay(candidate));
        }

        currentWeekStart = addWeeks(currentWeekStart, 1);
      }

      break;
    }

    case 'biweekly': {
      // Every 2 weeks on the same day-of-week as startDate.
      let current = startOfDay(start);

      while (!shouldStop(current, dates.length)) {
        if (boundaryDate && isBefore(boundaryDate, current) && !isSameDay(boundaryDate, current))
          break;

        dates.push(startOfDay(current));
        current = addWeeks(current, 2);
      }

      break;
    }

    case 'monthly': {
      // Same day-of-month each month. Clamps to end-of-month when needed
      // (e.g., Jan 31 -> Feb 28).
      const targetDayOfMonth = start.getDate();
      let currentMonth = new Date(start.getFullYear(), start.getMonth(), 1);

      while (!shouldStop(currentMonth, dates.length)) {
        const candidate = clampDayOfMonth(
          currentMonth.getFullYear(),
          currentMonth.getMonth(),
          targetDayOfMonth,
        );

        // Skip dates before start (only relevant for the first iteration).
        if (isBefore(candidate, start) && !isSameDay(candidate, start)) {
          currentMonth = addMonths(currentMonth, 1);
          continue;
        }

        // Skip dates after boundary.
        if (
          boundaryDate &&
          isBefore(boundaryDate, candidate) &&
          !isSameDay(boundaryDate, candidate)
        )
          break;

        dates.push(startOfDay(candidate));
        currentMonth = addMonths(currentMonth, 1);
      }

      break;
    }
  }

  return dates;
}
