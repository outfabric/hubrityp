/**
 * Date/timezone helpers for the agenda module.
 *
 * All dates are stored as UTC in the database. These helpers convert and
 * format them for display in the America/Sao_Paulo timezone using
 * `formatInTimeZone` from date-fns-tz to avoid the classic double-shift
 * pitfall of `toZonedTime` + plain `format`.
 */

import { addMinutes, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAO_PAULO_TZ = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Timezone conversion
// ---------------------------------------------------------------------------

/**
 * Converts a UTC date to the America/Sao_Paulo timezone.
 *
 * WARNING: The returned Date is a "fake" shifted date intended only for
 * non-formatting use cases (e.g., comparing day-of-week). For display
 * formatting, use the `formatSession*` helpers which call `formatInTimeZone`
 * directly to avoid the double-shift pitfall.
 *
 * @deprecated Prefer `formatSessionTime` / `formatSessionDateFull` etc. for
 * display. Only use this when you need the shifted Date object itself.
 */
export function toSaoPauloTime(utcDate: Date): Date {
  return toZonedTime(utcDate, SAO_PAULO_TZ);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Formats a UTC date as a time string in São Paulo timezone, e.g. "14:00".
 *
 * Uses `formatInTimeZone` to convert and format in a single step, avoiding
 * the double-shift bug when the system timezone matches the target timezone.
 */
export function formatSessionTime(date: Date): string {
  return formatInTimeZone(date, SAO_PAULO_TZ, 'HH:mm', { locale: ptBR });
}

/**
 * Formats a UTC date as a short date string in São Paulo timezone,
 * e.g. "15 de mai. 2026".
 */
export function formatSessionDate(date: Date): string {
  return formatInTimeZone(date, SAO_PAULO_TZ, "d 'de' MMM'.' yyyy", { locale: ptBR });
}

/**
 * Formats a UTC date as a full date string in São Paulo timezone,
 * e.g. "quinta-feira, 15 de maio de 2026".
 */
export function formatSessionDateFull(date: Date): string {
  return formatInTimeZone(date, SAO_PAULO_TZ, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Calculates the end time by adding the given duration (in minutes) to the
 * start time.
 */
export function calculateEndTime(startAt: Date, durationMinutes: number): Date {
  return addMinutes(startAt, durationMinutes);
}

/**
 * Returns `true` when the given date is strictly in the past compared to
 * the current instant.
 */
export function isInPast(date: Date): boolean {
  return isPast(date);
}
