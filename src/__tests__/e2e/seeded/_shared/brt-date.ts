/**
 * Date helpers for E2E tests that need to compute dates aligned with the
 * browser's timezone (America/Sao_Paulo).
 *
 * The Playwright browser context is configured with `timezoneId:
 * 'America/Sao_Paulo'`, but the Node.js test runner may be in a different
 * timezone (e.g., UTC in CI). These helpers ensure the test-runner's date
 * calculations match what the browser sees.
 */

import { toZonedTime } from 'date-fns-tz';

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * Returns a Date whose local components (getFullYear, getMonth, getDate,
 * getHours, etc.) represent the current wall-clock time in Sao Paulo.
 *
 * Example: if the UTC time is 2026-05-10T02:00:00Z (Sat), the Sao Paulo
 * wall-clock is 2026-05-09T23:00:00 (Fri). This function returns a Date
 * where `getDate()` is 9 and `getDay()` is 5 (Friday).
 *
 * This is useful when the test needs to compute "tomorrow" in the same
 * timezone the browser calendar uses.
 */
export function nowInBrt(): Date {
  return toZonedTime(new Date(), SAO_PAULO_TZ);
}

/**
 * Returns a Date representing "tomorrow" in the Sao Paulo timezone.
 *
 * The returned Date has local components one day ahead of the current
 * Sao Paulo wall-clock date. This matches what the browser's calendar
 * popover considers "tomorrow".
 */
export function tomorrowInBrt(): Date {
  const now = nowInBrt();
  // Add 1 day by manipulating the date component directly, avoiding
  // addDays() which works on timestamps and can drift across DST boundaries.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0, 0);
}
