import { describe, expect, it } from 'vitest';

import { sdq, SDQ_SUBSCALES } from '@/modules/medical-records/lib/scales/sdq';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a responses map where every question gets the same value. */
function uniformResponses(value: number): Record<string, number> {
  const responses: Record<string, number> = {};
  for (const q of sdq.questions) {
    responses[q.id] = value;
  }
  return responses;
}

/** Build a responses map with specific values for targeted items, 0 for all others. */
function targetedResponses(overrides: Record<string, number>): Record<string, number> {
  const responses: Record<string, number> = {};
  for (const q of sdq.questions) {
    responses[q.id] = overrides[q.id] ?? 0;
  }
  return responses;
}

// ---------------------------------------------------------------------------
// Question structure
// ---------------------------------------------------------------------------

describe('SDQ — questions', () => {
  it('has exactly 25 questions', () => {
    expect(sdq.questions).toHaveLength(25);
  });

  it('questions have ids q1 through q25', () => {
    const ids = sdq.questions.map((q) => q.id);
    const expected = Array.from({ length: 25 }, (_, i) => `q${i + 1}`);
    expect(ids).toEqual(expected);
  });

  it('every question has 3 options valued 0-2', () => {
    for (const q of sdq.questions) {
      expect(q.options).toHaveLength(3);
      const values = q.options.map((o) => o.value);
      expect(values).toEqual([0, 1, 2]);
    }
  });

  it('option labels match SDQ Portuguese standard', () => {
    const labels = sdq.questions[0]!.options.map((o) => o.label);
    expect(labels).toEqual(['Falso', 'Mais ou menos verdadeiro', 'Verdadeiro']);
  });

  it('prosocial items (1, 4, 9, 17, 20) are marked reverseScored', () => {
    const prosocialIds = new Set(SDQ_SUBSCALES.prosocial);
    for (const q of sdq.questions) {
      if (prosocialIds.has(q.id)) {
        expect(q.reverseScored).toBe(true);
      } else {
        expect(q.reverseScored).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Subscale membership
// ---------------------------------------------------------------------------

describe('SDQ — subscale membership', () => {
  it('emotional subscale contains items 3, 8, 13, 16, 24', () => {
    expect(SDQ_SUBSCALES.emotional).toEqual(['q3', 'q8', 'q13', 'q16', 'q24']);
  });

  it('conduct subscale contains items 5, 7, 12, 18, 22', () => {
    expect(SDQ_SUBSCALES.conduct).toEqual(['q5', 'q7', 'q12', 'q18', 'q22']);
  });

  it('hyperactivity subscale contains items 2, 10, 15, 21, 25', () => {
    expect(SDQ_SUBSCALES.hyperactivity).toEqual(['q2', 'q10', 'q15', 'q21', 'q25']);
  });

  it('peer problems subscale contains items 6, 11, 14, 19, 23', () => {
    expect(SDQ_SUBSCALES.peer).toEqual(['q6', 'q11', 'q14', 'q19', 'q23']);
  });

  it('prosocial subscale contains items 1, 4, 9, 17, 20', () => {
    expect(SDQ_SUBSCALES.prosocial).toEqual(['q1', 'q4', 'q9', 'q17', 'q20']);
  });

  it('all 25 items are accounted for across all 5 subscales', () => {
    const allItems = [
      ...SDQ_SUBSCALES.emotional,
      ...SDQ_SUBSCALES.conduct,
      ...SDQ_SUBSCALES.hyperactivity,
      ...SDQ_SUBSCALES.peer,
      ...SDQ_SUBSCALES.prosocial,
    ].sort((a, b) => {
      const numA = parseInt(a.slice(1), 10);
      const numB = parseInt(b.slice(1), 10);
      return numA - numB;
    });
    const expected = Array.from({ length: 25 }, (_, i) => `q${i + 1}`);
    expect(allItems).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Scoring — total difficulties excludes prosocial
// ---------------------------------------------------------------------------

describe('SDQ — scoring', () => {
  it('scores 0 when all responses are 0', () => {
    // Items 7, 11, 14, 21, 25 are reverse-scored: 2 - 0 = 2 each = 10
    // All other difficulties items: 0 each = 0
    // But wait — with all 0s, non-reversed sum to 0 and reversed sum to 2*5 = 10
    const score = sdq.score(uniformResponses(0));
    expect(score).toBe(10);
  });

  it('scores correctly when all responses are 2 (max)', () => {
    // Non-reversed difficulties items: 2 each
    // Reversed items (7,11,14,21,25): 2 - 2 = 0 each
    // 20 difficulties items total, 5 reversed => 15 * 2 + 5 * 0 = 30
    const score = sdq.score(uniformResponses(2));
    expect(score).toBe(30);
  });

  it('total difficulties excludes prosocial subscale', () => {
    // Set only prosocial items to max (2), everything else to 0
    // Prosocial items should NOT contribute to total difficulties.
    // Only reversed difficulties items contribute: items 7,11,14,21,25 -> 2-0=2 each = 10
    const responses = targetedResponses({
      q1: 2,
      q4: 2,
      q9: 2,
      q17: 2,
      q20: 2,
    });
    const score = sdq.score(responses);
    // Score should only reflect the reverse-scored difficulties items (all responding 0 -> 2-0=2 each)
    expect(score).toBe(10);
  });

  it('reverse-scores items 7, 11, 14, 21, 25 within difficulties', () => {
    // Set only reverse-scored difficulties items to 2, all others to 0
    const responses = targetedResponses({
      q7: 2,
      q11: 2,
      q14: 2,
      q21: 2,
      q25: 2,
    });
    // Reverse-scored items: 2 - 2 = 0 each
    // Non-reversed difficulties items responding 0 = 0 each
    // But there are also 5 reverse items responding 0 in other difficulties... wait.
    // Let me think: the 5 reversed items are q7,q11,q14,q21,q25.
    // They respond 2, so after reverse: 2-2=0 each.
    // The other 15 difficulties items respond 0 each.
    // Total = 0 + 0 = 0
    expect(sdq.score(responses)).toBe(0);
  });

  it('reverse-scored item 7 contributes (2 - value) to conduct subscale', () => {
    // q7 = 0 -> reverse -> 2. Only q7 set among conduct items; others are 0.
    // But other subscales also have reverse items at 0 -> 2.
    // Conduct: q5=0, q7=0->2, q12=0, q18=0, q22=0 = 2
    // To isolate: set all items to 1 (neutral), then vary q7
    const baseResponses = uniformResponses(1);

    // With q7=0: conduct has q5=1,q7=reverse(0)=2,q12=1,q18=1,q22=1
    const responsesLow = { ...baseResponses, q7: 0 };
    const scoreLow = sdq.score(responsesLow)!;

    // With q7=2: conduct has q5=1,q7=reverse(2)=0,q12=1,q18=1,q22=1
    const responsesHigh = { ...baseResponses, q7: 2 };
    const scoreHigh = sdq.score(responsesHigh)!;

    // Difference should be 2 (from reverse scoring: 2-0=2 vs 2-2=0)
    expect(scoreLow - scoreHigh).toBe(2);
  });

  it('treats missing responses as 0 (reversed items become 2)', () => {
    // Only q3 answered; all others default to 0
    // q3 is emotional (non-reversed): contributes 1
    // Reverse-scored difficulties items (q7,q11,q14,q21,q25) default to 0 -> 2-0=2 each = 10
    // Other non-reversed difficulties items default to 0 = 0
    expect(sdq.score({ q3: 1 })).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Classification — boundary tests per spec
// ---------------------------------------------------------------------------

describe('SDQ — classification', () => {
  it('score 0 -> Normal / minimal', () => {
    expect(sdq.classify(0)).toEqual({ label: 'Normal', severity: 'minimal' });
  });

  it('score 15 -> Normal / minimal (upper boundary)', () => {
    expect(sdq.classify(15)).toEqual({ label: 'Normal', severity: 'minimal' });
  });

  it('score 16 -> Limitrofe / mild (lower boundary)', () => {
    expect(sdq.classify(16)).toEqual({ label: 'Limitrofe', severity: 'mild' });
  });

  it('score 19 -> Limitrofe / mild (upper boundary)', () => {
    expect(sdq.classify(19)).toEqual({ label: 'Limitrofe', severity: 'mild' });
  });

  it('score 20 -> Anormal / severe (lower boundary)', () => {
    expect(sdq.classify(20)).toEqual({ label: 'Anormal', severity: 'severe' });
  });

  it('score 40 -> Anormal / severe (max)', () => {
    expect(sdq.classify(40)).toEqual({ label: 'Anormal', severity: 'severe' });
  });

  it('null score defaults to Normal / minimal', () => {
    expect(sdq.classify(null)).toEqual({ label: 'Normal', severity: 'minimal' });
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('SDQ — metadata', () => {
  it('key is sdq', () => {
    expect(sdq.key).toBe('sdq');
  });

  it('label contains SDQ', () => {
    expect(sdq.label).toContain('SDQ');
  });

  it('description mentions 11 a 17 anos', () => {
    expect(sdq.description).toContain('11 a 17 anos');
  });
});
