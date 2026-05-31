import { describe, expect, it } from 'vitest';

import { toNpsScore } from '@/modules/onboarding/lib/branded';

describe('toNpsScore', () => {
  it('accepts the lower bound 0', () => {
    expect(toNpsScore(0)).toBe(0);
  });

  it('accepts the upper bound 10', () => {
    expect(toNpsScore(10)).toBe(10);
  });

  it('rejects a value below the range', () => {
    expect(() => toNpsScore(-1)).toThrow(RangeError);
  });

  it('rejects a value above the range', () => {
    expect(() => toNpsScore(11)).toThrow(RangeError);
  });

  it('rejects a non-integer value within the range', () => {
    expect(() => toNpsScore(5.5)).toThrow(RangeError);
  });
});
