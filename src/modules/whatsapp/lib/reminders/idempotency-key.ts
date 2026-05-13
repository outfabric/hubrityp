/**
 * Generates a deterministic idempotency key for a reminder message.
 *
 * The key is a SHA-256 hex digest of `sessionId:kind`, ensuring that
 * the same session + kind combination always produces the same key.
 * This prevents duplicate message sends when a job is retried.
 */

import { createHash } from 'node:crypto';

/**
 * Returns a 64-character hex string uniquely identifying the reminder
 * for the given session and kind.
 */
export function generateIdempotencyKey(sessionId: string, kind: string): string {
  return createHash('sha256')
    .update(`${sessionId}:${kind}`)
    .digest('hex');
}
