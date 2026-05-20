import { describe, expect, it } from 'vitest';

import {
  computeExpiresAt,
  LARGE_EXPORT_THRESHOLD_BYTES,
} from '@/modules/medical-records/lib/exports/expiry-calculator';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('LARGE_EXPORT_THRESHOLD_BYTES', () => {
  it('is exactly 10_000_000 bytes', () => {
    expect(LARGE_EXPORT_THRESHOLD_BYTES).toBe(10_000_000);
  });
});

describe('computeExpiresAt', () => {
  const baseDate = new Date('2026-01-15T12:00:00.000Z');

  it('returns 24h expiry for files smaller than 10MB', () => {
    const result = computeExpiresAt(5_000_000, baseDate);
    expect(result.getTime() - baseDate.getTime()).toBe(TWENTY_FOUR_HOURS_MS);
  });

  it('returns 7d expiry for files larger than 10MB', () => {
    const result = computeExpiresAt(15_000_000, baseDate);
    expect(result.getTime() - baseDate.getTime()).toBe(SEVEN_DAYS_MS);
  });

  it('returns 24h expiry at exactly 10_000_000 bytes (threshold uses >)', () => {
    // Per design.md: ">10MB" means 10_000_000 is NOT large — stays in 24h branch
    const result = computeExpiresAt(10_000_000, baseDate);
    expect(result.getTime() - baseDate.getTime()).toBe(TWENTY_FOUR_HOURS_MS);
  });

  it('returns 7d expiry at 10_000_001 bytes (one byte over threshold)', () => {
    const result = computeExpiresAt(10_000_001, baseDate);
    expect(result.getTime() - baseDate.getTime()).toBe(SEVEN_DAYS_MS);
  });

  it('returns 24h expiry for zero-byte files', () => {
    const result = computeExpiresAt(0, baseDate);
    expect(result.getTime() - baseDate.getTime()).toBe(TWENTY_FOUR_HOURS_MS);
  });

  it('returns 24h expiry for negative file size (edge case)', () => {
    const result = computeExpiresAt(-100, baseDate);
    expect(result.getTime() - baseDate.getTime()).toBe(TWENTY_FOUR_HOURS_MS);
  });

  it('returns a Date object', () => {
    const result = computeExpiresAt(1000, baseDate);
    expect(result).toBeInstanceOf(Date);
  });
});
