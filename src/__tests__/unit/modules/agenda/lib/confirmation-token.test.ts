import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateConfirmationToken, isTokenExpired } from '@/modules/agenda/lib/confirmation-token';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-06-15T12:00:00Z').getTime();
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Setup — fake timers for isTokenExpired tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// generateConfirmationToken
// ---------------------------------------------------------------------------

describe('generateConfirmationToken', () => {
  it('generates a 43-character token', () => {
    const token = generateConfirmationToken();
    expect(token).toHaveLength(43);
  });

  it('contains only base64url-safe characters', () => {
    const token = generateConfirmationToken();
    expect(token).toMatch(BASE64URL_REGEX);
  });

  it('generates unique tokens on successive calls', () => {
    const tokenA = generateConfirmationToken();
    const tokenB = generateConfirmationToken();
    expect(tokenA).not.toBe(tokenB);
  });
});

// ---------------------------------------------------------------------------
// isTokenExpired
// ---------------------------------------------------------------------------

describe('isTokenExpired', () => {
  it('returns false for a future session start date', () => {
    const futureDate = new Date(FIXED_NOW + 3_600_000); // 1 hour from now
    expect(isTokenExpired(futureDate)).toBe(false);
  });

  it('returns true for a past session start date', () => {
    const pastDate = new Date(FIXED_NOW - 3_600_000); // 1 hour ago
    expect(isTokenExpired(pastDate)).toBe(true);
  });

  it('returns true when session start is exactly now (boundary)', () => {
    const exactlyNow = new Date(FIXED_NOW);
    expect(isTokenExpired(exactlyNow)).toBe(true);
  });
});
