/**
 * Pure helper that formats a notification timestamp into compact pt-BR relative
 * text for the bell dropdown (RF-11.16).
 *
 * All calendar-day arithmetic ("ontem") is evaluated in `America/Sao_Paulo` via
 * date-fns-tz, never the server's system timezone (UTC on Vercel), so the
 * "yesterday" boundary matches what the psychologist sees on their clock. The
 * sub-day buckets ("agora", "há N min", "há N h") are pure elapsed-time
 * arithmetic and are timezone-independent.
 *
 * `now` is injectable so the output is fully deterministic under test — no
 * hidden dependency on the wall clock.
 *
 * Display rules (most-recent first):
 *   - < 1 minute ago        → "agora"
 *   - < 60 minutes ago      → "há N min"
 *   - same SP calendar day  → "há N h"
 *   - previous SP day       → "ontem"
 *   - same SP year          → "DD/MM" (e.g. "15/05")
 *   - different SP year      → "DD/MM/YYYY" (e.g. "15/05/2024")
 *
 * Future timestamps (clock skew) collapse to "agora" rather than emitting a
 * misleading "in ..." string.
 */

import { differenceInHours, differenceInMinutes, differenceInSeconds } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

const SAO_PAULO_TZ = 'America/Sao_Paulo';
const SECONDS_IN_ONE_MINUTE = 60;
const MINUTES_IN_ONE_HOUR = 60;

/**
 * Formats `date` relative to `now` as compact pt-BR text.
 *
 * @param date - the notification's `createdAt` instant (UTC).
 * @param now  - reference instant; defaults to the current time. Inject in tests
 *               for deterministic output.
 */
export function formatNotificationTime(date: Date, now: Date = new Date()): string {
  const diffSeconds = differenceInSeconds(now, date);

  // Future or sub-minute → "agora". Guarding the future case keeps a slightly
  // skewed server clock from rendering a confusing "in N min" form.
  if (diffSeconds < SECONDS_IN_ONE_MINUTE) {
    return 'agora';
  }

  const diffMinutes = differenceInMinutes(now, date);
  if (diffMinutes < MINUTES_IN_ONE_HOUR) {
    return `há ${diffMinutes} min`;
  }

  // Calendar-day comparisons are done in São Paulo wall-clock time so the
  // "ontem" boundary lands on the local midnight, not the UTC one.
  const zonedDate = toZonedTime(date, SAO_PAULO_TZ);
  const zonedNow = toZonedTime(now, SAO_PAULO_TZ);

  const isSameCalendarDay =
    zonedDate.getFullYear() === zonedNow.getFullYear() &&
    zonedDate.getMonth() === zonedNow.getMonth() &&
    zonedDate.getDate() === zonedNow.getDate();

  if (isSameCalendarDay) {
    return `há ${differenceInHours(now, date)} h`;
  }

  // "ontem": the SP calendar day immediately before today's SP day.
  const yesterdayInSP = new Date(zonedNow);
  yesterdayInSP.setDate(yesterdayInSP.getDate() - 1);

  const isYesterday =
    zonedDate.getFullYear() === yesterdayInSP.getFullYear() &&
    zonedDate.getMonth() === yesterdayInSP.getMonth() &&
    zonedDate.getDate() === yesterdayInSP.getDate();

  if (isYesterday) {
    return 'ontem';
  }

  if (zonedDate.getFullYear() === zonedNow.getFullYear()) {
    return formatInTimeZone(date, SAO_PAULO_TZ, 'dd/MM');
  }

  return formatInTimeZone(date, SAO_PAULO_TZ, 'dd/MM/yyyy');
}
