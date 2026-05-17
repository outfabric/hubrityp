import { describe, expect, it } from 'vitest';

import { phq9 } from '@/modules/medical-records/lib/scales/phq9';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a responses map where every question gets the same value. */
function uniformResponses(value: number): Record<string, number> {
  const responses: Record<string, number> = {};
  for (const q of phq9.questions) {
    responses[q.id] = value;
  }
  return responses;
}

/** Build a responses map that sums to exactly `target`. */
function responsesWithTotal(target: number): Record<string, number> {
  const responses: Record<string, number> = {};
  let remaining = target;

  for (const q of phq9.questions) {
    const value = Math.min(remaining, 3);
    responses[q.id] = value;
    remaining -= value;
  }

  return responses;
}

// ---------------------------------------------------------------------------
// Question structure
// ---------------------------------------------------------------------------

describe('PHQ-9 — questions', () => {
  it('has exactly 9 questions', () => {
    expect(phq9.questions).toHaveLength(9);
  });

  it('questions have ids q1 through q9', () => {
    const ids = phq9.questions.map((q) => q.id);
    expect(ids).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']);
  });

  it('every question has 4 options valued 0-3', () => {
    for (const q of phq9.questions) {
      expect(q.options).toHaveLength(4);
      const values = q.options.map((o) => o.value);
      expect(values).toEqual([0, 1, 2, 3]);
    }
  });

  it('option labels match PHQ-9 Portuguese standard', () => {
    const labels = phq9.questions[0]!.options.map((o) => o.label);
    expect(labels).toEqual([
      'Nenhuma vez',
      'Varios dias',
      'Mais da metade dos dias',
      'Quase todos os dias',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('PHQ-9 — scoring', () => {
  it('scores 0 when all responses are 0', () => {
    expect(phq9.score(uniformResponses(0))).toBe(0);
  });

  it('scores 27 (max) when all responses are 3', () => {
    expect(phq9.score(uniformResponses(3))).toBe(27);
  });

  it('sums correctly for a known combination', () => {
    const responses: Record<string, number> = {
      q1: 1,
      q2: 2,
      q3: 0,
      q4: 3,
      q5: 1,
      q6: 2,
      q7: 0,
      q8: 1,
      q9: 0,
    };
    expect(phq9.score(responses)).toBe(10);
  });

  it('treats missing responses as 0', () => {
    expect(phq9.score({ q1: 3 })).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Classification — boundary tests per spec
// ---------------------------------------------------------------------------

describe('PHQ-9 — classification', () => {
  it('score 0 -> Minimo / minimal', () => {
    expect(phq9.classify(0)).toEqual({ label: 'Minimo', severity: 'minimal' });
  });

  it('score 4 -> Minimo / minimal (upper boundary)', () => {
    expect(phq9.classify(4)).toEqual({ label: 'Minimo', severity: 'minimal' });
  });

  it('score 5 -> Leve / mild (lower boundary)', () => {
    expect(phq9.classify(5)).toEqual({ label: 'Leve', severity: 'mild' });
  });

  it('score 9 -> Leve / mild (upper boundary)', () => {
    expect(phq9.classify(9)).toEqual({ label: 'Leve', severity: 'mild' });
  });

  it('score 10 -> Moderado / moderate (lower boundary)', () => {
    expect(phq9.classify(10)).toEqual({
      label: 'Moderado',
      severity: 'moderate',
    });
  });

  it('score 14 -> Moderado / moderate (upper boundary)', () => {
    expect(phq9.classify(14)).toEqual({
      label: 'Moderado',
      severity: 'moderate',
    });
  });

  it('score 15 -> Moderadamente grave / severe (lower boundary)', () => {
    expect(phq9.classify(15)).toEqual({
      label: 'Moderadamente grave',
      severity: 'severe',
    });
  });

  it('score 19 -> Moderadamente grave / severe (upper boundary)', () => {
    expect(phq9.classify(19)).toEqual({
      label: 'Moderadamente grave',
      severity: 'severe',
    });
  });

  it('score 20 -> Grave / severe (lower boundary)', () => {
    expect(phq9.classify(20)).toEqual({ label: 'Grave', severity: 'severe' });
  });

  it('score 27 -> Grave / severe (max)', () => {
    expect(phq9.classify(27)).toEqual({ label: 'Grave', severity: 'severe' });
  });

  it('null score defaults to Minimo / minimal', () => {
    expect(phq9.classify(null)).toEqual({
      label: 'Minimo',
      severity: 'minimal',
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: score + classify via responsesWithTotal helper
// ---------------------------------------------------------------------------

describe('PHQ-9 — score then classify (integration)', () => {
  it.each([
    { total: 4, label: 'Minimo', severity: 'minimal' },
    { total: 5, label: 'Leve', severity: 'mild' },
    { total: 14, label: 'Moderado', severity: 'moderate' },
    { total: 15, label: 'Moderadamente grave', severity: 'severe' },
    { total: 20, label: 'Grave', severity: 'severe' },
    { total: 27, label: 'Grave', severity: 'severe' },
  ] as const)('responses totalling $total -> $label / $severity', ({ total, label, severity }) => {
    const responses = responsesWithTotal(total);
    const score = phq9.score(responses);
    expect(score).toBe(total);
    expect(phq9.classify(score)).toEqual({ label, severity });
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('PHQ-9 — metadata', () => {
  it('key is phq9', () => {
    expect(phq9.key).toBe('phq9');
  });

  it('label contains PHQ-9', () => {
    expect(phq9.label).toContain('PHQ-9');
  });
});
