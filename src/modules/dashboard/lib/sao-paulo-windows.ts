import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Timezone-window helpers for the dashboard aggregate queries.
 *
 * Every clinical timestamp is stored as UTC (`timestamptz`). The dashboard,
 * however, reasons about calendar boundaries the psychologist experiences in
 * `America/Sao_Paulo`: "today" is the SP calendar day, "this week" is the SP
 * week starting Monday, "this month" is the SP calendar month. Computing those
 * boundaries naively against the server clock (UTC on Vercel) would drift the
 * day boundary by 3 hours and silently include/exclude late-evening sessions.
 *
 * The pattern here mirrors `modules/agenda/lib/date-helpers.ts`: read the
 * SP-local wall-clock parts via `formatInTimeZone`, assemble the local midnight
 * string, then convert that wall-clock instant back to UTC with `fromZonedTime`
 * so the returned bounds are directly comparable to the stored `timestamptz`
 * columns. This avoids the double-shift pitfall of `toZonedTime` + arithmetic.
 */

export const SAO_PAULO_TZ = 'America/Sao_Paulo';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC instant for the start of the SP calendar day containing `now`. */
export function startOfSaoPauloDay(now: Date): Date {
  const ymd = formatInTimeZone(now, SAO_PAULO_TZ, 'yyyy-MM-dd');
  return fromZonedTime(`${ymd}T00:00:00`, SAO_PAULO_TZ);
}

/**
 * UTC instant for the SP-day-start that is `days` calendar days offset from the
 * SP day containing `now` (negative = past). Anchors at noon of the shifted day
 * before snapping so a DST transition can never flip the target calendar date.
 */
function startOfSaoPauloDayShifted(now: Date, days: number): Date {
  const dayStart = startOfSaoPauloDay(now);
  const noonOfTarget = new Date(dayStart.getTime() + days * MS_PER_DAY + MS_PER_DAY / 2);
  return startOfSaoPauloDay(noonOfTarget);
}

/** UTC instant for the start of the SP day after the one containing `now`. */
export function startOfNextSaoPauloDay(now: Date): Date {
  return startOfSaoPauloDayShifted(now, 1);
}

/**
 * UTC instant for Monday 00:00 of the SP week containing `now`.
 *
 * Week starts on Monday (ISO / Brazilian convention). `formatInTimeZone` with
 * the `i` token yields ISO day-of-week (1 = Monday … 7 = Sunday) in SP local
 * time, so subtracting `isoDow - 1` calendar days lands on that week's Monday.
 */
export function startOfSaoPauloWeek(now: Date): Date {
  const isoDow = Number(formatInTimeZone(now, SAO_PAULO_TZ, 'i'));
  return startOfSaoPauloDayShifted(now, -(isoDow - 1));
}

/** UTC instant for the start of the SP week after the one containing `now`. */
export function startOfNextSaoPauloWeek(now: Date): Date {
  const weekStart = startOfSaoPauloWeek(now);
  // Advance 7 days from this week's Monday, anchored at noon before re-snapping.
  return startOfSaoPauloDayShifted(weekStart, 7);
}

/** UTC instant for the first day 00:00 of the SP calendar month of `now`. */
export function startOfSaoPauloMonth(now: Date): Date {
  const ym = formatInTimeZone(now, SAO_PAULO_TZ, 'yyyy-MM');
  return fromZonedTime(`${ym}-01T00:00:00`, SAO_PAULO_TZ);
}
