/**
 * Pure function that determines which sessions to update/detach when editing
 * a recurring session, based on the user's scope choice.
 *
 * Follows the Google Calendar "edit recurring event" pattern:
 *   - "this"             -> detach the target session from the series
 *   - "this_and_future"  -> split the series at the target session
 *   - "all"              -> update all future non-completed sessions
 *
 * This function is pure: it receives session data in memory and returns
 * the computed sets. The caller is responsible for DB mutations.
 */

import { subDays } from 'date-fns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditScope = 'this' | 'this_and_future' | 'all';

/** Session statuses considered "completed" and excluded from bulk edits. */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set(['done', 'cancelled', 'no_show']);

export interface SeriesSession {
  /** Session UUID. */
  id: string;
  /** Session start timestamp (UTC). */
  startAt: Date;
  /** Current status of the session. */
  status: string;
}

export interface EditScopeResult {
  /** Session IDs to apply the edit to. */
  toUpdate: string[];
  /** Session IDs to detach from the recurrence (set recurrence_id = NULL). */
  toDetach: string[];
  /**
   * When splitting a series ("this_and_future"), the old recurrence's
   * `end_date` should be set to this value (day before the target session).
   */
  newRecurrenceEndDate?: Date;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function computeEditScope(
  scope: EditScope,
  sessionId: string,
  allSeriesSessions: ReadonlyArray<SeriesSession>,
): EditScopeResult {
  // Sort by startAt ascending for consistent behavior.
  const sorted = [...allSeriesSessions].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const target = sorted.find((s) => s.id === sessionId);
  if (!target) {
    return { toUpdate: [], toDetach: [] };
  }

  switch (scope) {
    case 'this': {
      // Detach only the target session from the series.
      return {
        toUpdate: [],
        toDetach: [target.id],
      };
    }

    case 'this_and_future': {
      // Target + all sessions with startAt >= target's startAt.
      const fromTarget = sorted.filter((s) => s.startAt.getTime() >= target.startAt.getTime());

      const toUpdate = fromTarget.map((s) => s.id);

      // The old recurrence end date is the day before the target session.
      const newRecurrenceEndDate = subDays(target.startAt, 1);

      return {
        toUpdate,
        toDetach: [],
        newRecurrenceEndDate,
      };
    }

    case 'all': {
      // All future sessions that are NOT completed (done/cancelled/no_show).
      const now = new Date();
      const futureNonCompleted = sorted.filter(
        (s) => s.startAt.getTime() >= now.getTime() && !COMPLETED_STATUSES.has(s.status),
      );

      return {
        toUpdate: futureNonCompleted.map((s) => s.id),
        toDetach: [],
      };
    }
  }
}
