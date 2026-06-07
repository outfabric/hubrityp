import { describe, expect, it } from 'vitest';

import { gad7 } from '@/modules/medical-records/lib/scales/gad7';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a responses map where every question gets the same value. */
function uniformResponses(value: number): Record<string, number> {
  const responses: Record<string, number> = {};
  for (const q of gad7.questions) {
    responses[q.id] = value;
  }
  return responses;
}

/** Build a responses map that sums to exactly `target`. */
function responsesWithTotal(target: number): Record<string, number> {
  const responses: Record<string, number> = {};
  let remaining = target;

  for (const q of gad7.questions) {
    const value = Math.min(remaining, 3);
    responses[q.id] = value;
    remaining -= value;
  }

  return responses;
}

// ---------------------------------------------------------------------------
// Question structure
// ---------------------------------------------------------------------------

describe('GAD-7 — questions', () => {
  it('has exactly 7 questions', () => {
    expect(gad7.questions).toHaveLength(7);
  });

  it('questions have ids q1 through q7', () => {
    const ids = gad7.questions.map((q) => q.id);
    expect(ids).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']);
  });

  it('every question has 4 options valued 0-3', () => {
    for (const q of gad7.questions) {
      expect(q.options).toHaveLength(4);
      const values = q.options.map((o) => o.value);
      expect(values).toEqual([0, 1, 2, 3]);
    }
  });

  it('option labels match GAD-7 Portuguese standard', () => {
    const labels = gad7.questions[0]!.options.map((o) => o.label);
    expect(labels).toEqual([
      'Nenhuma vez',
      'Vários dias',
      'Mais da metade dos dias',
      'Quase todos os dias',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('GAD-7 — scoring', () => {
  it('scores 0 when all responses are 0', () => {
    expect(gad7.score(uniformResponses(0))).toBe(0);
  });

  it('scores 21 (max) when all responses are 3', () => {
    expect(gad7.score(uniformResponses(3))).toBe(21);
  });

  it('sums correctly for a known combination', () => {
    const responses: Record<string, number> = {
      q1: 1,
      q2: 2,
      q3: 0,
      q4: 3,
      q5: 1,
      q6: 2,
      q7: 1,
    };
    expect(gad7.score(responses)).toBe(10);
  });

  it('treats missing responses as 0', () => {
    expect(gad7.score({ q1: 3 })).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Classification — boundary tests per spec
// ---------------------------------------------------------------------------

describe('GAD-7 — classification', () => {
  it('score 0 -> Mínimo / minimal', () => {
    expect(gad7.classify(0)).toEqual({ label: 'Mínimo', severity: 'minimal' });
  });

  it('score 4 -> Mínimo / minimal (upper boundary)', () => {
    expect(gad7.classify(4)).toEqual({ label: 'Mínimo', severity: 'minimal' });
  });

  it('score 5 -> Leve / mild (lower boundary)', () => {
    expect(gad7.classify(5)).toEqual({ label: 'Leve', severity: 'mild' });
  });

  it('score 9 -> Leve / mild (upper boundary)', () => {
    expect(gad7.classify(9)).toEqual({ label: 'Leve', severity: 'mild' });
  });

  it('score 10 -> Moderado / moderate (lower boundary)', () => {
    expect(gad7.classify(10)).toEqual({
      label: 'Moderado',
      severity: 'moderate',
    });
  });

  it('score 14 -> Moderado / moderate (upper boundary)', () => {
    expect(gad7.classify(14)).toEqual({
      label: 'Moderado',
      severity: 'moderate',
    });
  });

  it('score 15 -> Grave / severe (lower boundary)', () => {
    expect(gad7.classify(15)).toEqual({ label: 'Grave', severity: 'severe' });
  });

  it('score 21 -> Grave / severe (max)', () => {
    expect(gad7.classify(21)).toEqual({ label: 'Grave', severity: 'severe' });
  });

  it('null score defaults to Mínimo / minimal', () => {
    expect(gad7.classify(null)).toEqual({
      label: 'Mínimo',
      severity: 'minimal',
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: score + classify via responsesWithTotal helper
// ---------------------------------------------------------------------------

describe('GAD-7 — score then classify (integration)', () => {
  it.each([
    { total: 4, label: 'Mínimo', severity: 'minimal' },
    { total: 5, label: 'Leve', severity: 'mild' },
    { total: 9, label: 'Leve', severity: 'mild' },
    { total: 10, label: 'Moderado', severity: 'moderate' },
    { total: 14, label: 'Moderado', severity: 'moderate' },
    { total: 15, label: 'Grave', severity: 'severe' },
    { total: 21, label: 'Grave', severity: 'severe' },
  ] as const)('responses totalling $total -> $label / $severity', ({ total, label, severity }) => {
    const responses = responsesWithTotal(total);
    const score = gad7.score(responses);
    expect(score).toBe(total);
    expect(gad7.classify(score)).toEqual({ label, severity });
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('GAD-7 — metadata', () => {
  it('key is gad7', () => {
    expect(gad7.key).toBe('gad7');
  });

  it('label contains GAD-7', () => {
    expect(gad7.label).toContain('GAD-7');
  });
});
