/**
 * Row-level validation for CSV patient import.
 *
 * Validates a single mapped CSV row against business rules (phone format,
 * email format, date format). Returns structured errors and warnings so
 * the UI can display per-row feedback.
 *
 * Pure module — no I/O, no DB queries. Duplicate checks are handled
 * separately via a Server Action.
 */

import { formatPhone, isValidBrazilianPhone } from './patient-validators';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single CSV row after column mapping, with all values as strings. */
export interface MappedCsvRow {
  full_name?: string;
  phone?: string;
  email?: string;
  birth_date?: string;
  tags?: string;
  notes?: string;
}

/** Validation result for a single CSV row. */
export interface CsvRowValidationResult {
  /** Whether the row is valid (no errors — warnings are acceptable). */
  valid: boolean;
  /** Blocking errors that prevent import. */
  errors: string[];
  /** Non-blocking warnings (informational, row can still be imported). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

/** Basic email regex — intentionally permissive, matching the Zod `.email()` behaviour. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** DD/MM/YYYY format. */
const DATE_DMY_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;

/** YYYY-MM-DD (ISO) format. */
const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a date string in DD/MM/YYYY or YYYY-MM-DD format and returns
 * whether it represents a valid calendar date.
 */
function isValidDate(value: string): boolean {
  let year: number;
  let month: number;
  let day: number;

  if (DATE_DMY_REGEX.test(value)) {
    const parts = value.split('/');
    day = Number(parts[0]);
    month = Number(parts[1]);
    year = Number(parts[2]);
  } else if (DATE_ISO_REGEX.test(value)) {
    const parts = value.split('-');
    year = Number(parts[0]);
    month = Number(parts[1]);
    day = Number(parts[2]);
  } else {
    return false;
  }

  // Validate calendar date by constructing a Date and checking roundtrip
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a single mapped CSV row.
 *
 * Rules:
 * - `full_name` is required (non-empty after trim).
 * - `phone`, if present, must be a valid Brazilian mobile number. The
 *   function first attempts to normalize the raw input via `formatPhone`
 *   before checking canonical format, so "11912345678" is accepted.
 * - `email`, if present, must match basic email format.
 * - `birth_date`, if present, must be DD/MM/YYYY or YYYY-MM-DD and
 *   represent a valid calendar date.
 * - `tags` and `notes` are free-text — no validation errors.
 *
 * @returns A result with `valid`, `errors`, and `warnings`.
 */
export function validateCsvRow(row: MappedCsvRow): CsvRowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- full_name (required) ---
  const name = row.full_name?.trim() ?? '';
  if (name.length === 0) {
    errors.push('Nome é obrigatório.');
  } else if (name.length < 2) {
    errors.push('O nome deve ter pelo menos 2 caracteres.');
  }

  // --- phone (optional, but must be valid BR mobile if provided) ---
  const rawPhone = row.phone?.trim() ?? '';
  if (rawPhone.length > 0) {
    // Try to normalize first (handles "11912345678" → "+55 11 91234-5678")
    const formatted = formatPhone(rawPhone);
    if (!isValidBrazilianPhone(formatted)) {
      errors.push('Telefone inválido.');
    }
  }

  // --- email (optional, but must match format if provided) ---
  const rawEmail = row.email?.trim() ?? '';
  if (rawEmail.length > 0 && !EMAIL_REGEX.test(rawEmail)) {
    errors.push('E-mail inválido.');
  }

  // --- birth_date (optional, must be valid date format if provided) ---
  const rawDate = row.birth_date?.trim() ?? '';
  if (rawDate.length > 0) {
    if (!isValidDate(rawDate)) {
      errors.push('Data de nascimento inválida. Use DD/MM/AAAA ou AAAA-MM-DD.');
    }
  }

  // --- tags: informational only ---
  // No validation — free-text, comma-separated.

  // --- notes: informational only ---
  // No validation — free-text.

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
