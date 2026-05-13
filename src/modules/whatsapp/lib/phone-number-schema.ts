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
 * Validates an E.164 phone number: starts with `+`, followed by 7-15 digits
 * where the first digit is non-zero.
 *
 * The minimum of 7 digits ensures that a bare country code (e.g. "+55")
 * is rejected — a valid phone number requires country code + subscriber number.
 */
export const phoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, {
    message: 'Telefone inválido. Use o formato +55 (DD) NNNNN-NNNN.',
  });

// ---------------------------------------------------------------------------
// Derived type
// ---------------------------------------------------------------------------

export type PhoneNumber = z.infer<typeof phoneNumberSchema>;
