import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSessionLocked } from '@/modules/agenda/lib/session-lock';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

// Use a fixed "now" so tests are deterministic.
const FIXED_NOW = new Date('2026-06-15T12:00:00Z').getTime();

// ---------------------------------------------------------------------------
// Setup — fake timers so Date.now() is stable
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// done sessions — time-based lock
// ---------------------------------------------------------------------------

describe('isSessionLocked — done sessions', () => {
  it('returns false when done 3 days ago (within window)', () => {
    const updatedAt = new Date(FIXED_NOW - 3 * ONE_DAY_MS);
    expect(isSessionLocked({ status: 'done', updatedAt })).toBe(false);
  });

  it('returns false when done exactly 7 days ago (boundary — not locked)', () => {
    const updatedAt = new Date(FIXED_NOW - SEVEN_DAYS_MS);
    expect(isSessionLocked({ status: 'done', updatedAt })).toBe(false);
  });

  it('returns true when done 8 days ago (past window)', () => {
    const updatedAt = new Date(FIXED_NOW - 8 * ONE_DAY_MS);
    expect(isSessionLocked({ status: 'done', updatedAt })).toBe(true);
  });

  it('returns false when done exactly 7*24*60*60*1000 ms ago (boundary test)', () => {
    // Exactly 7 days in milliseconds — should NOT be locked (> not >=)
    const updatedAt = new Date(FIXED_NOW - SEVEN_DAYS_MS);
    expect(isSessionLocked({ status: 'done', updatedAt })).toBe(false);
  });

  it('returns true when done 7*24*60*60*1000 + 1 ms ago (just past boundary)', () => {
    const updatedAt = new Date(FIXED_NOW - SEVEN_DAYS_MS - 1);
    expect(isSessionLocked({ status: 'done', updatedAt })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// non-done statuses — never locked
// ---------------------------------------------------------------------------

describe('isSessionLocked — non-done statuses', () => {
  it('returns false for scheduled session even 10 days ago', () => {
    const updatedAt = new Date(FIXED_NOW - 10 * ONE_DAY_MS);
    expect(isSessionLocked({ status: 'scheduled', updatedAt })).toBe(false);
  });

  it('returns false for confirmed session even 30 days ago', () => {
    const updatedAt = new Date(FIXED_NOW - 30 * ONE_DAY_MS);
    expect(isSessionLocked({ status: 'confirmed', updatedAt })).toBe(false);
  });

  it('returns false for cancelled session even 10 days ago', () => {
    const updatedAt = new Date(FIXED_NOW - 10 * ONE_DAY_MS);
    expect(isSessionLocked({ status: 'cancelled', updatedAt })).toBe(false);
  });

  it('returns false for no_show session even 10 days ago', () => {
    const updatedAt = new Date(FIXED_NOW - 10 * ONE_DAY_MS);
    expect(isSessionLocked({ status: 'no_show', updatedAt })).toBe(false);
  });
});
