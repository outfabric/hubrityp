/**
 * Cancellation notice calculator — pure module.
 *
 * Determines how far in advance a session was cancelled, bucketed
 * into one of four tiers. Used by the cancellation Server Action to
 * decide whether a charge applies and by UI to display the notice
 * category.
 *
 * All comparisons use raw UTC milliseconds (no timezone conversion
 * needed — both dates must already be in the same reference).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cancellation notice tier based on how far before the session start it was cancelled. */
export type CancellationNotice = '24h+' | 'less_24h' | 'less_1h' | 'on_time';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000;
const TWENTY_FOUR_HOURS = 24 * MS_PER_HOUR;

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

/**
 * Returns the cancellation notice tier.
 *
 * Logic (per design.md Decision #2):
 *   - diffHours >= 24  → '24h+'      (cancelled with ample notice)
 *   - diffHours >= 1   → 'less_24h'  (less than a day but at least 1 hour)
 *   - diffHours > 0    → 'less_1h'   (less than 1 hour but before start)
 *   - diffHours <= 0   → 'on_time'   (at or after the session start)
 */
export function calculateCancellationNotice(
  sessionStartAt: Date,
  cancelledAt: Date,
): CancellationNotice {
  const diffMs = sessionStartAt.getTime() - cancelledAt.getTime();

  if (diffMs >= TWENTY_FOUR_HOURS) return '24h+';
  if (diffMs >= MS_PER_HOUR) return 'less_24h';
  if (diffMs > 0) return 'less_1h';
  return 'on_time';
}
