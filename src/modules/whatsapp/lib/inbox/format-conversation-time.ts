/**
 * Pure function that formats a conversation timestamp for the inbox list.
 *
 * All timezone arithmetic uses America/Sao_Paulo via date-fns-tz so that
 * "today", "yesterday", and calendar-day boundaries are evaluated in BRT/BRST,
 * not the server's system timezone.
 *
 * Display rules (most-recent first):
 *   - < 1 minute ago  → "agora"
 *   - Same calendar day → "h HH:mm" (e.g. "h 14:30")
 *   - Previous calendar day → "ontem"
 *   - Same calendar year → "DD/MM" (e.g. "15/05")
 *   - Different year → "DD/MM/YYYY" (e.g. "15/05/2025")
 */

import { differenceInSeconds } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAO_PAULO_TZ = 'America/Sao_Paulo';
const SECONDS_IN_ONE_MINUTE = 60;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function formatConversationTime(date: Date, now: Date = new Date()): string {
  const diffSeconds = differenceInSeconds(now, date);

  // Less than 1 minute ago
  if (diffSeconds < SECONDS_IN_ONE_MINUTE) {
    return 'agora';
  }

  // Convert both dates to São Paulo timezone for calendar-day comparisons
  const zonedDate = toZonedTime(date, SAO_PAULO_TZ);
  const zonedNow = toZonedTime(now, SAO_PAULO_TZ);

  const dateDay = zonedDate.getDate();
  const dateMonth = zonedDate.getMonth();
  const dateYear = zonedDate.getFullYear();

  const nowDay = zonedNow.getDate();
  const nowMonth = zonedNow.getMonth();
  const nowYear = zonedNow.getFullYear();

  const isSameCalendarDay = dateDay === nowDay && dateMonth === nowMonth && dateYear === nowYear;

  if (isSameCalendarDay) {
    // "h 14:30" — literal "h" + space + HH:mm
    const timeStr = formatInTimeZone(date, SAO_PAULO_TZ, 'HH:mm');
    return `h ${timeStr}`;
  }

  // Check if date is "yesterday" in São Paulo timezone.
  // Build the start-of-today in São Paulo, then check if zonedDate falls
  // on the calendar day immediately before.
  const yesterdayInSP = new Date(zonedNow);
  yesterdayInSP.setDate(yesterdayInSP.getDate() - 1);

  const isYesterday =
    dateDay === yesterdayInSP.getDate() &&
    dateMonth === yesterdayInSP.getMonth() &&
    dateYear === yesterdayInSP.getFullYear();

  if (isYesterday) {
    return 'ontem';
  }

  // Same year → "DD/MM"
  if (dateYear === nowYear) {
    return formatInTimeZone(date, SAO_PAULO_TZ, 'dd/MM');
  }

  // Different year → "DD/MM/YYYY"
  return formatInTimeZone(date, SAO_PAULO_TZ, 'dd/MM/yyyy');
}
