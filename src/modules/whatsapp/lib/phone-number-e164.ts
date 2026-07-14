/**
 * E.164 normalization for outbound WhatsApp destinations.
 *
 * Patient phone numbers are persisted in the canonical masked BR format
 * `+55 DD NNNNN-NNNN` (spaces + hyphen). Twilio requires a strict E.164
 * address (`+` followed by digits only) and rejects anything else with
 * error 21211 (INVALID_PHONE). This helper bridges the two: it strips every
 * non-digit, re-prefixes a single `+`, and only returns the result if it is
 * a valid E.164 number.
 *
 * @see ITU-T E.164: https://www.itu.int/rec/T-REC-E.164
 */

import { E164_REGEX } from './phone-number-schema';

/**
 * Normalizes an arbitrary phone string to E.164.
 *
 * Removes all non-digit characters, re-prefixes a single `+`, and validates
 * against the shared E.164 regex. Idempotent for input already in E.164.
 *
 * @returns the E.164 string, or `null` when the input cannot be normalized
 *   (empty, too few digits, leading zero after the `+`, or no digits at all).
 */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const candidate = `+${digits}`;
  return E164_REGEX.test(candidate) ? candidate : null;
}
