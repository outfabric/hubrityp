/**
 * Strong password policy used by the signup flow.
 *
 * The function is the **single source of truth** consumed by both the
 * signup UI (live feedback as the user types) and the Zod refinement on
 * `signupInputSchema.password`. Login passwords are deliberately NOT
 * subject to this policy: existing users may have shorter or weaker
 * passwords, and login validation must remain backward-compatible.
 *
 * Pure module — no I/O, no side effects, no framework imports.
 */

/** The five rule keys returned by `passwordPolicy(...)`. */
export type PasswordRule = 'length' | 'uppercase' | 'lowercase' | 'digit' | 'special';

/** Minimum length required by the policy. */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Allowed special characters. Anchored explicitly inside a character class
 * to avoid surprises with regex metacharacters; `]` and `\\` are escaped.
 */
const SPECIAL_CHARS = '!@#$%^&*()_+\\-=[\\]{}|;:,.<>?';
const SPECIAL_REGEX = new RegExp(`[${SPECIAL_CHARS}]`);
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const DIGIT_REGEX = /\d/;

/**
 * Evaluate the strong-password policy.
 *
 * Returns `{ ok: true, missing: [] }` when every rule is satisfied; otherwise
 * `{ ok: false, missing: [...] }` listing every rule that failed. The order
 * of `missing` follows the canonical order of `PasswordRule`
 * (`length, uppercase, lowercase, digit, special`) so consumers (UI badges,
 * test assertions) can rely on a stable ordering.
 */
export function passwordPolicy(s: string): { ok: boolean; missing: PasswordRule[] } {
  const missing: PasswordRule[] = [];

  if (s.length < PASSWORD_MIN_LENGTH) missing.push('length');
  if (!UPPERCASE_REGEX.test(s)) missing.push('uppercase');
  if (!LOWERCASE_REGEX.test(s)) missing.push('lowercase');
  if (!DIGIT_REGEX.test(s)) missing.push('digit');
  if (!SPECIAL_REGEX.test(s)) missing.push('special');

  return { ok: missing.length === 0, missing };
}
