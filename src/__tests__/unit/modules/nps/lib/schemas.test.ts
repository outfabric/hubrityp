import { describe, expect, it } from 'vitest';

import { isDetractor, isEligibleForNps, npsAnswerSchema } from '@/modules/nps';

// ---------------------------------------------------------------------------
// isDetractor — boundary at 6/7
// ---------------------------------------------------------------------------

describe('isDetractor', () => {
  it('classifies 0–6 as detractor', () => {
    for (const score of [0, 1, 2, 3, 4, 5, 6]) {
      expect(isDetractor(score)).toBe(true);
    }
  });

  it('classifies 7–10 (passive/promoter) as not a detractor', () => {
    for (const score of [7, 8, 9, 10]) {
      expect(isDetractor(score)).toBe(false);
    }
  });

  it('holds at the 6/7 boundary', () => {
    expect(isDetractor(6)).toBe(true);
    expect(isDetractor(7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEligibleForNps — day-7 trigger, not-yet-responded
// ---------------------------------------------------------------------------

describe('isEligibleForNps', () => {
  const firstAccessAt = new Date('2026-06-01T12:00:00Z');
  const day6 = new Date('2026-06-07T11:59:59Z'); // < 7×24h after first access
  const day7 = new Date('2026-06-08T12:00:00Z'); // exactly 7×24h after first access

  it('is NOT eligible on day 6 (less than 7 full days elapsed)', () => {
    expect(isEligibleForNps({ firstAccessAt, npsRespondedAt: null, now: day6 })).toBe(false);
  });

  it('is eligible on day 7 (7 full days elapsed, not yet responded)', () => {
    expect(isEligibleForNps({ firstAccessAt, npsRespondedAt: null, now: day7 })).toBe(true);
  });

  it('is NOT eligible once the user has already responded, even after 7 days', () => {
    expect(
      isEligibleForNps({
        firstAccessAt,
        npsRespondedAt: new Date('2026-06-08T13:00:00Z'),
        now: day7,
      }),
    ).toBe(false);
  });

  it('is NOT eligible when the user has never accessed the app', () => {
    expect(isEligibleForNps({ firstAccessAt: null, npsRespondedAt: null, now: day7 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// npsAnswerSchema — reused contract sanity (0–10 integer, optional feedback)
// ---------------------------------------------------------------------------

describe('npsAnswerSchema', () => {
  it('accepts a valid score with optional feedback', () => {
    expect(npsAnswerSchema.safeParse({ score: 9 }).success).toBe(true);
    expect(npsAnswerSchema.safeParse({ score: 0, feedback: 'too slow' }).success).toBe(true);
  });

  it('rejects out-of-range and non-integer scores', () => {
    expect(npsAnswerSchema.safeParse({ score: 11 }).success).toBe(false);
    expect(npsAnswerSchema.safeParse({ score: -1 }).success).toBe(false);
    expect(npsAnswerSchema.safeParse({ score: 5.5 }).success).toBe(false);
  });
});
