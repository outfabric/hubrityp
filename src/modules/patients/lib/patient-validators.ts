import { cpf } from 'cpf-cnpj-validator';

/**
 * Brazilian phone and CPF validation helpers for the patient module.
 *
 * Pure module — no I/O. Safe to import from anywhere.
 */

/**
 * Regex matching a Brazilian mobile phone in the canonical stored format:
 * `+55 DD NNNNN-NNNN` where DD is 2 digits (DDD) and the mobile number has
 * 9 digits (always starts with 9 for mobile).
 *
 * Examples:
 *   +55 11 91234-5678 ✓
 *   +55 21 99876-5432 ✓
 *   +55 1 91234-5678  ✗ (single-digit DDD)
 *   55 11 91234-5678  ✗ (missing +)
 */
const BR_MOBILE_REGEX = /^\+55 \d{2} 9\d{4}-\d{4}$/;

/**
 * Returns `true` if `phone` matches the canonical Brazilian mobile format:
 * `+55 DD NNNNN-NNNN` (country code, space, 2-digit DDD, space, 5-digit
 * prefix starting with 9, hyphen, 4-digit suffix).
 */
export function isValidBrazilianPhone(phone: string): boolean {
  return BR_MOBILE_REGEX.test(phone);
}

/**
 * Returns `true` if `value` is a structurally and mathematically valid CPF.
 * Rejects trivial sequences (all same digit, e.g. 000.000.000-00,
 * 111.111.111-11) via the cpf-cnpj-validator library.
 *
 * Accepts both formatted (NNN.NNN.NNN-NN) and unformatted (NNNNNNNNNNN)
 * inputs.
 */
export function isValidCpf(value: string): boolean {
  return cpf.isValid(value);
}

/**
 * Formats a raw phone string into the canonical `+55 DD NNNNN-NNNN` format.
 *
 * Strips all non-digit characters, then re-assembles. If the resulting digits
 * don't form a valid 12- or 13-digit BR mobile number (with or without
 * country code), returns the original string unchanged (caller can validate
 * separately).
 *
 * Handles:
 *   - "5511912345678"  → "+55 11 91234-5678"
 *   - "11912345678"    → "+55 11 91234-5678"
 *   - "+55 11 91234-5678" → "+55 11 91234-5678" (already formatted)
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // 13 digits: country code (55) + DDD (2) + number (9)
  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const prefix = digits.slice(4, 9);
    const suffix = digits.slice(9, 13);
    return `+55 ${ddd} ${prefix}-${suffix}`;
  }

  // 11 digits: DDD (2) + number (9)
  if (digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const prefix = digits.slice(2, 7);
    const suffix = digits.slice(7, 11);
    return `+55 ${ddd} ${prefix}-${suffix}`;
  }

  // Cannot format — return as-is
  return phone;
}
