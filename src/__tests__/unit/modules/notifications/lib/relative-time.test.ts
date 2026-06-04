import { describe, expect, it } from 'vitest';

import { formatNotificationTime } from '@/modules/notifications/lib/relative-time';

/**
 * `now` is injected on every case so the assertions are deterministic and do
 * not depend on the wall clock or the runner's system timezone — all
 * calendar-day boundaries are evaluated in America/Sao_Paulo.
 *
 * 2024-05-15T15:00:00Z is 2024-05-15 12:00 in São Paulo (UTC-3), comfortably
 * mid-day so the offsets below never cross a local midnight unexpectedly.
 */
const NOW = new Date('2024-05-15T15:00:00Z');

describe('formatNotificationTime', () => {
  it('returns "agora" for a sub-minute-old timestamp', () => {
    const date = new Date(NOW.getTime() - 30_000); // 30s ago
    expect(formatNotificationTime(date, NOW)).toBe('agora');
  });

  it('returns "agora" at exactly 59 seconds ago (just under the minute boundary)', () => {
    const date = new Date(NOW.getTime() - 59_000);
    expect(formatNotificationTime(date, NOW)).toBe('agora');
  });

  it('returns "há 1 min" exactly at the 60-second boundary', () => {
    const date = new Date(NOW.getTime() - 60_000);
    expect(formatNotificationTime(date, NOW)).toBe('há 1 min');
  });

  it('returns "há 5 min" for a 5-minute-old timestamp', () => {
    const date = new Date(NOW.getTime() - 5 * 60_000);
    expect(formatNotificationTime(date, NOW)).toBe('há 5 min');
  });

  it('returns "há 59 min" just under the hour boundary', () => {
    const date = new Date(NOW.getTime() - 59 * 60_000);
    expect(formatNotificationTime(date, NOW)).toBe('há 59 min');
  });

  it('switches to hours at exactly 60 minutes ago', () => {
    const date = new Date(NOW.getTime() - 60 * 60_000);
    expect(formatNotificationTime(date, NOW)).toBe('há 1 h');
  });

  it('returns "há N h" for an earlier time on the same São Paulo day', () => {
    // 12:00 SP now; 5h earlier is 07:00 SP — still the same SP calendar day.
    const date = new Date(NOW.getTime() - 5 * 60 * 60_000);
    expect(formatNotificationTime(date, NOW)).toBe('há 5 h');
  });

  it('returns "ontem" for the previous São Paulo calendar day', () => {
    // 26h earlier than 12:00 SP → 10:00 SP on 2024-05-14 (yesterday in SP).
    const date = new Date(NOW.getTime() - 26 * 60 * 60_000);
    expect(formatNotificationTime(date, NOW)).toBe('ontem');
  });

  it('returns "ontem" right after the SP midnight boundary, not "há N h"', () => {
    // now = 2024-05-15 00:30 SP (03:30 UTC); 1h earlier = 2024-05-14 23:30 SP.
    const nowEarlyMorning = new Date('2024-05-15T03:30:00Z');
    const date = new Date(nowEarlyMorning.getTime() - 60 * 60_000);
    expect(formatNotificationTime(date, nowEarlyMorning)).toBe('ontem');
  });

  it('returns "DD/MM" for an older date within the same SP year', () => {
    const date = new Date('2024-03-10T15:00:00Z'); // 12:00 SP, 2024-03-10
    expect(formatNotificationTime(date, NOW)).toBe('10/03');
  });

  it('returns "DD/MM/YYYY" for a date in a previous SP year', () => {
    const date = new Date('2023-12-20T15:00:00Z'); // 12:00 SP, 2023-12-20
    expect(formatNotificationTime(date, NOW)).toBe('20/12/2023');
  });

  it('collapses a future timestamp (clock skew) to "agora"', () => {
    const date = new Date(NOW.getTime() + 5 * 60_000);
    expect(formatNotificationTime(date, NOW)).toBe('agora');
  });
});
