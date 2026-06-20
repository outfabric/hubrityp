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
 * Formats a phone input progressively into `+55 DD NNNNN-NNNN`.
 * Strips non-digits and applies the mask as the user types.
 *
 * Designed for controlled inputs: call on every `onChange` and set the
 * returned value back into the field.
 */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return '';
  if (digits.length <= 2) return `+55 ${digits}`;
  if (digits.length <= 7) return `+55 ${digits.slice(0, 2)} ${digits.slice(2)}`;
  if (digits.length <= 11) {
    return `+55 ${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  // If user started typing with 55 prefix
  if (digits.startsWith('55') && digits.length <= 13) {
    const rest = digits.slice(2);
    if (rest.length <= 2) return `+55 ${rest}`;
    if (rest.length <= 7) return `+55 ${rest.slice(0, 2)} ${rest.slice(2)}`;
    return `+55 ${rest.slice(0, 2)} ${rest.slice(2, 7)}-${rest.slice(7)}`;
  }
  // Truncate
  return `+55 ${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

/**
 * Formats a national phone input progressively into `DD NNNNN-NNNN`.
 *
 * Strips non-digits, caps at 11 digits (2-digit DDD + 9-digit mobile), and
 * applies the mask as the user types. The returned text NEVER contains the
 * `+55` country code, so calling it on its own output is a no-op — that is what
 * makes it idempotent across keystrokes in a controlled input:
 *
 *   maskNationalPhone(maskNationalPhone(x)) === maskNationalPhone(x)
 *
 * The `+55` country code lives only at the boundary (see `toCanonical`), never
 * inside the editable value, which is why the old `maskPhone` re-fed its own
 * `5` digits back as data.
 */
export function maskNationalPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);

  if (digits.length === 0) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Boundary helper: converts an editable national value into the canonical
 * stored format `+55 DD NNNNN-NNNN`.
 *
 * Returns `''` for empty input so an untouched optional field stays empty
 * rather than becoming a bare `+55 `. Otherwise prefixes the national mask
 * with the country code exactly once.
 */
export function toCanonical(national: string): string {
  if (national.trim().length === 0) return '';
  return `+55 ${maskNationalPhone(national)}`;
}

/**
 * Boundary helper: converts a canonical stored value (`+55 DD NNNNN-NNNN`)
 * back into the editable national display (`DD NNNNN-NNNN`).
 *
 * Strips a single leading `+55`/`55` country code (the canonical form always
 * carries one) before re-applying the national mask, so editing a stored
 * patient pre-fills the field without a duplicated country code.
 */
export function toNationalDisplay(canonical: string): string {
  const digits = canonical.replace(/\D/g, '');
  // A canonical BR number is 13 digits (55 + DDD + 9). Drop the leading 55
  // only when it is acting as the country code, never when it is the DDD of
  // a national-length input.
  const national = digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
  return maskNationalPhone(national);
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
