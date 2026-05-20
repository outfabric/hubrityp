/**
 * Pure function that computes the expiry timestamp for a completed
 * prontuario export based on its file size.
 *
 * Policy (design.md section 5, "Expiry strategy"):
 *   - <= 10 MB  -> 24 hours after completion
 *   - >  10 MB  -> 7 days after completion
 *
 * The threshold constant is exported so that other modules (email
 * decision logic, notification copy) can reference it without
 * hard-coding the number.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files larger than this (in bytes) get a 7-day expiry instead of 24h. */
export const LARGE_EXPORT_THRESHOLD_BYTES = 10_000_000 as const;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------------------

/**
 * Compute the `expires_at` timestamp for a prontuario export.
 *
 * @param fileSize    Size of the generated PDF in bytes.
 * @param completedAt Timestamp when the export finished building.
 * @returns           The point in time when the file should be garbage-collected.
 */
export function computeExpiresAt(fileSize: number, completedAt: Date): Date {
  const ttlMs = fileSize > LARGE_EXPORT_THRESHOLD_BYTES ? SEVEN_DAYS_MS : TWENTY_FOUR_HOURS_MS;

  return new Date(completedAt.getTime() + ttlMs);
}
