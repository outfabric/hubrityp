/**
 * Secure token generation for remote scale application links.
 *
 * Produces a 64-character hex string (256 bits of entropy) suitable
 * for unguessable, single-use URLs sent to patients. Server-only
 * utility — does NOT carry a 'use server' directive.
 */

import { randomBytes } from 'crypto';

/** Generate a cryptographically random 64-hex-char token. */
export function generateScaleToken(): string {
  return randomBytes(32).toString('hex');
}
