/**
 * Confirmation token utilities — pure module.
 *
 * Generates cryptographically secure tokens for patient session
 * confirmation links and checks whether a confirmation window has
 * expired (session already started).
 */

import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * Generates a 32-byte cryptographically random token encoded as base64url.
 *
 * The resulting string is 43 characters long (256 bits of entropy) and
 * safe for use in URLs without additional encoding.
 */
export function generateConfirmationToken(): string {
  return randomBytes(32).toString('base64url');
}

// ---------------------------------------------------------------------------
// Expiration check
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the session has already started (or is starting right now),
 * meaning the confirmation token should be considered expired.
 *
 * A token is valid only while `Date.now() < sessionStartAt`.
 */
export function isTokenExpired(sessionStartAt: Date): boolean {
  return Date.now() >= sessionStartAt.getTime();
}
