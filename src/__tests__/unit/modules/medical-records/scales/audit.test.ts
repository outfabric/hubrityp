import { describe, expect, it } from 'vitest';

import { audit } from '@/modules/medical-records/lib/scales/audit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a responses map where every question gets the same value. */
function uniformResponses(value: number): Record<string, number> {
  const responses: Record<string, number> = {};
  for (const q of audit.questions) {
    responses[q.id] = value;
  }
  return responses;
}

/**
 * Build a responses map that sums to exactly `target`.
 *
 * AUDIT has mixed option ranges: q1-q8 max 4, q9-q10 max 4.
 * We fill greedily using each question's actual max option value.
 */
function responsesWithTotal(target: number): Record<string, number> {
  const responses: Record<string, number> = {};
  let remaining = target;

  for (const q of audit.questions) {
    const maxValue = Math.max(...q.options.map((o) => o.value));
    const value = Math.min(remaining, maxValue);
    responses[q.id] = value;
    remaining -= value;
  }

  return responses;
}

// ---------------------------------------------------------------------------
// Question structure
// ---------------------------------------------------------------------------

describe('AUDIT — questions', () => {
  it('has exactly 10 questions', () => {
    expect(audit.questions).toHaveLength(10);
  });

  it('questions have ids q1 through q10', () => {
    const ids = audit.questions.map((q) => q.id);
    expect(ids).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10']);
  });

  it('questions 1-8 have 5 options valued 0-4', () => {
    for (let i = 0; i < 8; i++) {
      const q = audit.questions[i]!;
      expect(q.options).toHaveLength(5);
      const values = q.options.map((o) => o.value);
      expect(values).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('questions 9-10 have 3 options valued 0, 2, 4', () => {
    for (let i = 8; i < 10; i++) {
      const q = audit.questions[i]!;
      expect(q.options).toHaveLength(3);
      const values = q.options.map((o) => o.value);
      expect(values).toEqual([0, 2, 4]);
    }
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('AUDIT — scoring', () => {
  it('scores 0 when all responses are 0', () => {
    expect(audit.score(uniformResponses(0))).toBe(0);
  });

  it('scores 40 (max) when all responses are max', () => {
    // q1-q8 at 4 = 32, q9-q10 at 4 = 8, total = 40
    const responses: Record<string, number> = {};
    for (const q of audit.questions) {
      const maxValue = Math.max(...q.options.map((o) => o.value));
      responses[q.id] = maxValue;
    }
    expect(audit.score(responses)).toBe(40);
  });

  it('sums correctly for a known combination', () => {
    const responses: Record<string, number> = {
      q1: 2,
      q2: 1,
      q3: 0,
      q4: 3,
      q5: 1,
      q6: 0,
      q7: 2,
      q8: 1,
      q9: 0,
      q10: 2,
    };
    expect(audit.score(responses)).toBe(12);
  });

  it('treats missing responses as 0', () => {
    expect(audit.score({ q1: 4 })).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Classification — boundary tests per spec
// ---------------------------------------------------------------------------

describe('AUDIT — classification', () => {
  it('score 0 -> Baixo risco / minimal', () => {
    expect(audit.classify(0)).toEqual({ label: 'Baixo risco', severity: 'minimal' });
  });

  it('score 7 -> Baixo risco / minimal (upper boundary)', () => {
    expect(audit.classify(7)).toEqual({ label: 'Baixo risco', severity: 'minimal' });
  });

  it('score 8 -> Uso de risco / mild (lower boundary)', () => {
    expect(audit.classify(8)).toEqual({ label: 'Uso de risco', severity: 'mild' });
  });

  it('score 15 -> Uso de risco / mild (upper boundary)', () => {
    expect(audit.classify(15)).toEqual({ label: 'Uso de risco', severity: 'mild' });
  });

  it('score 16 -> Uso nocivo / moderate (lower boundary)', () => {
    expect(audit.classify(16)).toEqual({
      label: 'Uso nocivo',
      severity: 'moderate',
    });
  });

  it('score 19 -> Uso nocivo / moderate (upper boundary)', () => {
    expect(audit.classify(19)).toEqual({
      label: 'Uso nocivo',
      severity: 'moderate',
    });
  });

  it('score 20 -> Provavel dependencia / severe (lower boundary)', () => {
    expect(audit.classify(20)).toEqual({
      label: 'Provavel dependencia',
      severity: 'severe',
    });
  });

  it('score 40 -> Provavel dependencia / severe (max)', () => {
    expect(audit.classify(40)).toEqual({
      label: 'Provavel dependencia',
      severity: 'severe',
    });
  });

  it('null score defaults to Baixo risco / minimal', () => {
    expect(audit.classify(null)).toEqual({
      label: 'Baixo risco',
      severity: 'minimal',
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end: score + classify via responsesWithTotal helper
// ---------------------------------------------------------------------------

describe('AUDIT — score then classify (integration)', () => {
  it.each([
    { total: 7, label: 'Baixo risco', severity: 'minimal' },
    { total: 8, label: 'Uso de risco', severity: 'mild' },
    { total: 15, label: 'Uso de risco', severity: 'mild' },
    { total: 16, label: 'Uso nocivo', severity: 'moderate' },
    { total: 19, label: 'Uso nocivo', severity: 'moderate' },
    { total: 20, label: 'Provavel dependencia', severity: 'severe' },
    { total: 40, label: 'Provavel dependencia', severity: 'severe' },
  ] as const)('responses totalling $total -> $label / $severity', ({ total, label, severity }) => {
    const responses = responsesWithTotal(total);
    const score = audit.score(responses);
    expect(score).toBe(total);
    expect(audit.classify(score)).toEqual({ label, severity });
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('AUDIT — metadata', () => {
  it('key is audit', () => {
    expect(audit.key).toBe('audit');
  });

  it('label contains AUDIT', () => {
    expect(audit.label).toContain('AUDIT');
  });
});
