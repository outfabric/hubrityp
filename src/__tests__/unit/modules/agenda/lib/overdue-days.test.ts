import { describe, expect, it } from 'vitest';

import { overdueDays } from '@/modules/agenda/lib/overdue-days';

const MS_PER_DAY = 86_400_000;

/** Fixed reference instant used as the injected `now` for determinism. */
const NOW = new Date('2026-06-15T12:00:00Z');

/** Build a start date `days` days before `NOW` (plus an optional ms offset). */
function startBefore(days: number, offsetMs = 0): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY - offsetMs);
}

describe('overdueDays', () => {
  it('counts 16 full days elapsed', () => {
    expect(overdueDays(startBefore(16), NOW)).toBe(16);
  });

  it('counts exactly the 7-day boundary', () => {
    expect(overdueDays(startBefore(7), NOW)).toBe(7);
  });

  it('returns 6 just under the 7-day boundary (floors elapsed duration)', () => {
    // One millisecond shy of 7 full days → still 6 full days.
    expect(overdueDays(startBefore(7, -1), NOW)).toBe(6);
  });

  it('counts less than 7 days', () => {
    expect(overdueDays(startBefore(3), NOW)).toBe(3);
  });

  it('returns 0 within the first day', () => {
    expect(overdueDays(startBefore(0, 60_000), NOW)).toBe(0);
  });

  it('returns a negative value for a future session', () => {
    expect(overdueDays(new Date(NOW.getTime() + MS_PER_DAY), NOW)).toBe(-1);
  });
});
