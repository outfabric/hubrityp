import { describe, expect, it } from 'vitest';

import { generateScaleToken } from '@/modules/medical-records/lib/scales/token';

describe('generateScaleToken', () => {
  it('returns a 64-character string', () => {
    const token = generateScaleToken();
    expect(token).toHaveLength(64);
  });

  it('contains only lowercase hex characters [0-9a-f]', () => {
    const token = generateScaleToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different tokens on successive calls', () => {
    const a = generateScaleToken();
    const b = generateScaleToken();
    expect(a).not.toBe(b);
  });
});
