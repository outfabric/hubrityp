/**
 * Date/timezone helpers for the agenda module.
 *
 * All dates are stored as UTC in the database. These helpers convert and
 * format them for display in the America/Sao_Paulo timezone using date-fns
 * with the pt-BR locale.
 */

import { addMinutes, format, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';

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
 * The returned Date has its internal timestamp shifted so that calling
 * `getHours()` / `format()` etc. returns values in São Paulo local time.
 */
export function toSaoPauloTime(utcDate: Date): Date {
  return toZonedTime(utcDate, SAO_PAULO_TZ);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Formats a date as a time string, e.g. "14:00".
 *
 * Expects a date already in the desired timezone (call {@link toSaoPauloTime}
 * first when working with UTC dates from the database).
 */
export function formatSessionTime(date: Date): string {
  return format(date, 'HH:mm', { locale: ptBR });
}

/**
 * Formats a date as a short date string, e.g. "15 de mai. 2026".
 *
 * Expects a date already in the desired timezone.
 */
export function formatSessionDate(date: Date): string {
  return format(date, "d 'de' MMM'.' yyyy", { locale: ptBR });
}

/**
 * Formats a date as a full date string, e.g. "quinta-feira, 15 de maio de 2026".
 *
 * Expects a date already in the desired timezone.
 */
export function formatSessionDateFull(date: Date): string {
  return format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
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
