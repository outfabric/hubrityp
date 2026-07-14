/**
 * Phone number schema — E.164 format validation.
 *
 * Used for WhatsApp Business phone numbers (connection flow) and
 * alternative reminder phones on patients.
 *
 * @see ITU-T E.164: https://www.itu.int/rec/T-REC-E.164
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * E.164 shape: `+`, a non-zero leading digit, then 6-14 more digits
 * (7-15 digits total). Single source of truth reused by `toE164()`.
 *
 * The minimum of 7 digits ensures that a bare country code (e.g. "+55")
 * is rejected — a valid phone number requires country code + subscriber number.
 */
export const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Validates an E.164 phone number: starts with `+`, followed by 7-15 digits
 * where the first digit is non-zero.
 */
export const phoneNumberSchema = z.string().regex(E164_REGEX, {
  message: 'Telefone inválido. Use o formato +55 (DD) NNNNN-NNNN.',
});

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type PhoneNumber = z.infer<typeof phoneNumberSchema>;
