/**
 * Pure function for detecting time conflicts between a candidate session
 * and a list of existing sessions.
 *
 * Uses the standard interval overlap formula:
 *   existingStart < candidateEnd AND existingEnd > candidateStart
 *
 * Per spec RN-03.01, conflicts produce a warning (not a block) — the caller
 * decides how to surface the result.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CandidateInterval {
  startAt: Date;
  endAt: Date;
}

export interface ExistingSession {
  id: string;
  startAt: Date;
  endAt: Date;
  /** Patient name for regular sessions, null for blocking slots. */
  patientName: string | null;
  /** Title for blocking slots, null for regular sessions. */
  blockingTitle: string | null;
}

export interface ConflictResult {
  /** ID of the conflicting session. */
  sessionId: string;
  /** Human-readable label: patient name or blocking title. */
  label: string;
  /** Start time of the conflicting session. */
  conflictStart: Date;
  /** End time of the conflicting session. */
  conflictEnd: Date;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Detects which existing sessions overlap with the candidate interval.
 *
 * Two intervals overlap when: existingStart < candidateEnd AND existingEnd > candidateStart.
 * Adjacent intervals (one ends exactly when the other starts) do NOT overlap.
 *
 * @returns Array of {@link ConflictResult} for each overlapping session (empty = no conflicts).
 */
export function detectConflicts(
  candidate: CandidateInterval,
  existingSessions: ReadonlyArray<ExistingSession>,
): ConflictResult[] {
  return existingSessions
    .filter((session) => session.startAt < candidate.endAt && session.endAt > candidate.startAt)
    .map((session) => ({
      sessionId: session.id,
      label: session.blockingTitle ?? session.patientName ?? '',
      conflictStart: session.startAt,
      conflictEnd: session.endAt,
    }));
}
