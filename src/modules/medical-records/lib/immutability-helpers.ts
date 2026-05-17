/**
 * Immutability enforcement helpers for evolution notes.
 *
 * RN-05.02: Evolutions become immutable (addendum-only) after 30 days.
 * The 30-day window is measured from creation time to "now".
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Returns true if the record is still within the editable window
 * (strictly less than 30 days since creation).
 */
export function isWithinEditWindow(createdAt: Date, now?: Date): boolean {
  const reference = now ?? new Date();
  const elapsed = reference.getTime() - createdAt.getTime();
  return elapsed < THIRTY_DAYS_MS;
}

/**
 * Returns true if the record has passed the immutability threshold
 * (30 days or more since creation), forcing addendum mode.
 */
export function shouldForceAddendum(createdAt: Date, now?: Date): boolean {
  return !isWithinEditWindow(createdAt, now);
}
