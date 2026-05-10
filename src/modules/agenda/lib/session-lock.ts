/**
 * 7-day edit lock for completed sessions (RN-03.04).
 *
 * Pure function — no DB access. Consumers call `isSessionLocked(...)` to
 * determine whether a `done` session has passed the edit window.
 *
 * Only sessions with status `'done'` can be locked. All other statuses
 * always return `false`, regardless of how long ago they were updated.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns `true` if the session is `done` **and** more than 7 days have
 * elapsed since `updatedAt` (strict UTC comparison: > 7 days, not >=).
 */
export function isSessionLocked(session: { status: string; updatedAt: Date }): boolean {
  if (session.status !== 'done') return false;
  return Date.now() - session.updatedAt.getTime() > SEVEN_DAYS_MS;
}
