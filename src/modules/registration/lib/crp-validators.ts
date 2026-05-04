import { regionalCodeToUf, type UfCode } from './uf-table';

/**
 * CRP number parsing and validation helpers.
 *
 * A CRP number is shaped `NN/MMMMMMM` where `NN` is the 2-digit regional
 * council code (Apêndice A do PRD) and `MMMMMMM` is the 4–7 digit serial
 * issued by that council. Both halves are required and the slash separator
 * is fixed.
 *
 * Pure module — no I/O. Safe to import from anywhere.
 */

/** Regex matching the canonical CRP form: `^\\d{2}/\\d{4,7}$`. */
const CRP_REGEX = /^\d{2}\/\d{4,7}$/;

/**
 * Strict format check — returns `true` iff `s` matches `^\\d{2}/\\d{4,7}$`.
 * Does NOT verify that the regional prefix is one of the known CRP councils;
 * that semantic check is the responsibility of
 * `isCrpRegionalConsistentWithUf`.
 */
export function isValidCrpFormat(s: string): boolean {
  return CRP_REGEX.test(s);
}

/**
 * Parse a CRP number into its `regional` (2-digit prefix) and `serial`
 * (the rest after the slash) parts. Returns `null` for any input that fails
 * the strict format check, so callers can use `parseCrpNumber(s) ?? ...`
 * for safe fallbacks.
 */
export function parseCrpNumber(s: string): { regional: string; serial: string } | null {
  if (!isValidCrpFormat(s)) return null;
  const [regional, serial] = s.split('/') as [string, string];
  return { regional, serial };
}

/**
 * Cross-field validator: the CRP regional prefix must map to the supplied
 * UF per `regionalCodeToUf`. Multi-UF councils (e.g. CRP-20 → AM/RR/AC/RO)
 * are handled correctly because the table stores UFs as a list.
 *
 * Returns `false` when either the CRP is malformed, the regional prefix
 * is not a known council, or the UF is not covered by the council. Returns
 * `true` only when the prefix is a known council AND the UF appears in its
 * coverage list.
 */
export function isCrpRegionalConsistentWithUf(crpNumber: string, uf: string): boolean {
  const parsed = parseCrpNumber(crpNumber);
  if (!parsed) return false;

  const allowed = regionalCodeToUf[parsed.regional];
  if (!allowed) return false;

  return (allowed as readonly string[]).includes(uf);
}

// Re-export the UF type so call sites that only pull CRP helpers don't need
// to import from `uf-table` directly. (The barrel in section 6 is the
// canonical surface for module consumers.)
export type { UfCode };
