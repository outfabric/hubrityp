import { describe, expect, it } from 'vitest';

import {
  calculateCancellationNotice,
  type CancellationNotice,
} from '@/modules/agenda/lib/cancellation-notice';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;

/** Fixed session start time — arbitrary UTC instant. */
const SESSION_START = new Date('2026-06-15T14:00:00Z');

/** Create a cancellation date by subtracting `offsetMs` from the session start. */
function cancelledBefore(offsetMs: number): Date {
  return new Date(SESSION_START.getTime() - offsetMs);
}

/** Create a cancellation date by adding `offsetMs` after the session start. */
function cancelledAfter(offsetMs: number): Date {
  return new Date(SESSION_START.getTime() + offsetMs);
}

// ---------------------------------------------------------------------------
// '24h+' — cancelled >= 24 hours before
// ---------------------------------------------------------------------------

describe("calculateCancellationNotice — '24h+'", () => {
  it('returns 24h+ when cancelled 30h before', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(30 * ONE_HOUR_MS))).toBe(
      '24h+',
    );
  });

  it('returns 24h+ when cancelled exactly 24h before (boundary inclusive)', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(TWENTY_FOUR_HOURS_MS))).toBe(
      '24h+',
    );
  });
});

// ---------------------------------------------------------------------------
// 'less_24h' — cancelled >= 1h and < 24h before
// ---------------------------------------------------------------------------

describe("calculateCancellationNotice — 'less_24h'", () => {
  it('returns less_24h when cancelled 23h59m before', () => {
    const offset = 23 * ONE_HOUR_MS + 59 * ONE_MINUTE_MS;
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(offset))).toBe('less_24h');
  });

  it('returns less_24h when cancelled 5h before', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(5 * ONE_HOUR_MS))).toBe(
      'less_24h',
    );
  });

  it('returns less_24h when cancelled exactly 1h before (boundary inclusive)', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(ONE_HOUR_MS))).toBe(
      'less_24h',
    );
  });
});

// ---------------------------------------------------------------------------
// 'less_1h' — cancelled > 0 and < 1h before
// ---------------------------------------------------------------------------

describe("calculateCancellationNotice — 'less_1h'", () => {
  it('returns less_1h when cancelled 59m before', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(59 * ONE_MINUTE_MS))).toBe(
      'less_1h',
    );
  });

  it('returns less_1h when cancelled 30m before', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(30 * ONE_MINUTE_MS))).toBe(
      'less_1h',
    );
  });

  it('returns less_1h when cancelled 1m before', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledBefore(ONE_MINUTE_MS))).toBe(
      'less_1h',
    );
  });
});

// ---------------------------------------------------------------------------
// 'on_time' — cancelled at or after the session start
// ---------------------------------------------------------------------------

describe("calculateCancellationNotice — 'on_time'", () => {
  it('returns on_time when cancelled exactly at start', () => {
    expect(calculateCancellationNotice(SESSION_START, SESSION_START)).toBe('on_time');
  });

  it('returns on_time when cancelled 10m after start', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledAfter(10 * ONE_MINUTE_MS))).toBe(
      'on_time',
    );
  });

  it('returns on_time when cancelled 2h after start', () => {
    expect(calculateCancellationNotice(SESSION_START, cancelledAfter(2 * ONE_HOUR_MS))).toBe(
      'on_time',
    );
  });
});

// ---------------------------------------------------------------------------
// Return type check
// ---------------------------------------------------------------------------

describe('calculateCancellationNotice — type safety', () => {
  it('returns a value assignable to CancellationNotice', () => {
    const result: CancellationNotice = calculateCancellationNotice(
      SESSION_START,
      cancelledBefore(ONE_HOUR_MS),
    );
    expect(['24h+', 'less_24h', 'less_1h', 'on_time']).toContain(result);
  });
});
