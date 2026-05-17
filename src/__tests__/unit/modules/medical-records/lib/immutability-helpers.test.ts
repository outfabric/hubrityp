import { describe, expect, it } from 'vitest';

import {
  isWithinEditWindow,
  shouldForceAddendum,
} from '@/modules/medical-records/lib/immutability-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(days: number, from?: Date): Date {
  const base = from ?? new Date('2024-06-15T12:00:00Z');
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
}

const NOW = new Date('2024-06-15T12:00:00Z');

// ---------------------------------------------------------------------------
// isWithinEditWindow
// ---------------------------------------------------------------------------

describe('isWithinEditWindow', () => {
  it('returns true when created 0 days ago (just now)', () => {
    expect(isWithinEditWindow(NOW, NOW)).toBe(true);
  });

  it('returns true when created 1 day ago', () => {
    const createdAt = daysAgo(1, NOW);
    expect(isWithinEditWindow(createdAt, NOW)).toBe(true);
  });

  it('returns true when created 29 days ago', () => {
    const createdAt = daysAgo(29, NOW);
    expect(isWithinEditWindow(createdAt, NOW)).toBe(true);
  });

  it('returns false when created exactly 30 days ago (boundary)', () => {
    const createdAt = daysAgo(30, NOW);
    expect(isWithinEditWindow(createdAt, NOW)).toBe(false);
  });

  it('returns false when created 31 days ago', () => {
    const createdAt = daysAgo(31, NOW);
    expect(isWithinEditWindow(createdAt, NOW)).toBe(false);
  });

  it('returns false when created 365 days ago', () => {
    const createdAt = daysAgo(365, NOW);
    expect(isWithinEditWindow(createdAt, NOW)).toBe(false);
  });

  it('uses current time when now is not provided', () => {
    // Created 1 second ago — should be within window
    const createdAt = new Date(Date.now() - 1000);
    expect(isWithinEditWindow(createdAt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldForceAddendum
// ---------------------------------------------------------------------------

describe('shouldForceAddendum', () => {
  it('returns false when created 0 days ago', () => {
    expect(shouldForceAddendum(NOW, NOW)).toBe(false);
  });

  it('returns false when created 29 days ago', () => {
    const createdAt = daysAgo(29, NOW);
    expect(shouldForceAddendum(createdAt, NOW)).toBe(false);
  });

  it('returns true when created exactly 30 days ago (boundary)', () => {
    const createdAt = daysAgo(30, NOW);
    expect(shouldForceAddendum(createdAt, NOW)).toBe(true);
  });

  it('returns true when created 31 days ago', () => {
    const createdAt = daysAgo(31, NOW);
    expect(shouldForceAddendum(createdAt, NOW)).toBe(true);
  });

  it('is the inverse of isWithinEditWindow', () => {
    const testDays = [0, 1, 15, 29, 30, 31, 60, 365];
    for (const days of testDays) {
      const createdAt = daysAgo(days, NOW);
      expect(shouldForceAddendum(createdAt, NOW)).toBe(!isWithinEditWindow(createdAt, NOW));
    }
  });
});
