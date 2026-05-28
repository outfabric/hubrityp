import { describe, expect, it } from 'vitest';

import { computeCost, MODEL_PRICING, PRICING_VERSION } from '@/modules/ai-transcription';

// ---------------------------------------------------------------------------
// PRICING_VERSION
// ---------------------------------------------------------------------------

describe('PRICING_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PRICING_VERSION)).toBe(true);
    expect(PRICING_VERSION).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// MODEL_PRICING table
// ---------------------------------------------------------------------------

describe('MODEL_PRICING', () => {
  it('contains at least one model', () => {
    expect(Object.keys(MODEL_PRICING).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(MODEL_PRICING))(
    '%s has positive input and output rates',
    (_model, pricing) => {
      expect(pricing.inputUsdPerMillionTokens).toBeGreaterThan(0);
      expect(pricing.outputUsdPerMillionTokens).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// computeCost
// ---------------------------------------------------------------------------

describe('computeCost', () => {
  it('returns correct cost for a known model (gemini-2.5-flash)', () => {
    const result = computeCost({
      model: 'gemini-2.5-flash',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    // 1M input × $0.30/M + 1M output × $2.50/M = $2.80
    expect(result).toBeCloseTo(2.8, 10);
  });

  it('returns correct cost for gemini-2.5-pro with fractional token counts', () => {
    const result = computeCost({
      model: 'gemini-2.5-pro',
      inputTokens: 500_000,
      outputTokens: 200_000,
    });

    // 0.5M × $1.25/M + 0.2M × $10.00/M = $0.625 + $2.00 = $2.625
    expect(result).toBeCloseTo(2.625, 10);
  });

  it('returns correct cost for gemini-3.5-flash (env default)', () => {
    const result = computeCost({
      model: 'gemini-3.5-flash',
      inputTokens: 10_000,
      outputTokens: 5_000,
    });

    // 0.01M × $1.50/M + 0.005M × $9.00/M = $0.015 + $0.045 = $0.06
    expect(result).toBeCloseTo(0.06, 10);
  });

  it('returns null for an unknown model', () => {
    const result = computeCost({
      model: 'gemini-99.9-ultra',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(result).toBeNull();
  });

  it('returns 0 when both token counts are zero', () => {
    const result = computeCost({
      model: 'gemini-2.5-flash',
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(result).toBe(0);
  });

  it('returns 0 when input tokens are zero and output tokens are zero for any known model', () => {
    for (const model of Object.keys(MODEL_PRICING)) {
      const result = computeCost({ model, inputTokens: 0, outputTokens: 0 });
      expect(result).toBe(0);
    }
  });

  it('handles input-only cost (output tokens = 0)', () => {
    const result = computeCost({
      model: 'gemini-2.0-flash',
      inputTokens: 2_000_000,
      outputTokens: 0,
    });

    // 2M × $0.10/M + 0 = $0.20
    expect(result).toBeCloseTo(0.2, 10);
  });

  it('handles output-only cost (input tokens = 0)', () => {
    const result = computeCost({
      model: 'gemini-2.0-flash',
      inputTokens: 0,
      outputTokens: 2_000_000,
    });

    // 0 + 2M × $0.40/M = $0.80
    expect(result).toBeCloseTo(0.8, 10);
  });
});
