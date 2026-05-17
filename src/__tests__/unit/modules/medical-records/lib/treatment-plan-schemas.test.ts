import { describe, expect, it } from 'vitest';

import {
  goalSchema,
  getTreatmentPlanInputSchema,
  listTreatmentPlanVersionsInputSchema,
  phaseSchema,
  upsertTreatmentPlanInputSchema,
} from '@/modules/medical-records/lib/treatment-plan-schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440000';

function makeGoal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_UUID,
    description: 'Reduzir ansiedade social',
    targetDate: '2026-06-30',
    order: 0,
    ...overrides,
  };
}

function makePhase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_UUID,
    title: 'Fase inicial',
    description: 'Acolhimento e vinculo terapeutico',
    order: 0,
    completed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// goalSchema
// ---------------------------------------------------------------------------

describe('goalSchema', () => {
  it('accepts a goal with a valid ISO date', () => {
    const result = goalSchema.safeParse(makeGoal());
    expect(result.success).toBe(true);
  });

  it('accepts a goal with null targetDate', () => {
    const result = goalSchema.safeParse(makeGoal({ targetDate: null }));
    expect(result.success).toBe(true);
  });

  it('rejects a goal with empty description', () => {
    const result = goalSchema.safeParse(makeGoal({ description: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a goal with invalid date format', () => {
    const result = goalSchema.safeParse(makeGoal({ targetDate: '30/06/2026' }));
    expect(result.success).toBe(false);
  });

  it('rejects a goal with partial date format', () => {
    const result = goalSchema.safeParse(makeGoal({ targetDate: '2026-6-30' }));
    expect(result.success).toBe(false);
  });

  it('rejects a goal with non-UUID id', () => {
    const result = goalSchema.safeParse(makeGoal({ id: 'not-a-uuid' }));
    expect(result.success).toBe(false);
  });

  it('rejects a goal with negative order', () => {
    const result = goalSchema.safeParse(makeGoal({ order: -1 }));
    expect(result.success).toBe(false);
  });

  it('rejects a goal description exceeding 5_000 chars', () => {
    const result = goalSchema.safeParse(makeGoal({ description: 'x'.repeat(5_001) }));
    expect(result.success).toBe(false);
  });

  it('accepts a goal description at exactly 5_000 chars', () => {
    const result = goalSchema.safeParse(makeGoal({ description: 'x'.repeat(5_000) }));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// phaseSchema
// ---------------------------------------------------------------------------

describe('phaseSchema', () => {
  it('accepts a phase with all fields valid', () => {
    const result = phaseSchema.safeParse(makePhase());
    expect(result.success).toBe(true);
  });

  it('accepts a phase with empty description (allowed)', () => {
    const result = phaseSchema.safeParse(makePhase({ description: '' }));
    expect(result.success).toBe(true);
  });

  it('rejects a phase with empty title', () => {
    const result = phaseSchema.safeParse(makePhase({ title: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects a phase with non-UUID id', () => {
    const result = phaseSchema.safeParse(makePhase({ id: 'bad' }));
    expect(result.success).toBe(false);
  });

  it('rejects a phase with non-boolean completed', () => {
    const result = phaseSchema.safeParse(makePhase({ completed: 'yes' }));
    expect(result.success).toBe(false);
  });

  it('rejects a phase with negative order', () => {
    const result = phaseSchema.safeParse(makePhase({ order: -1 }));
    expect(result.success).toBe(false);
  });

  it('rejects a phase title exceeding 500 chars', () => {
    const result = phaseSchema.safeParse(makePhase({ title: 'x'.repeat(501) }));
    expect(result.success).toBe(false);
  });

  it('rejects a phase description exceeding 5_000 chars', () => {
    const result = phaseSchema.safeParse(makePhase({ description: 'x'.repeat(5_001) }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// upsertTreatmentPlanInputSchema
// ---------------------------------------------------------------------------

describe('upsertTreatmentPlanInputSchema', () => {
  const VALID_INPUT = {
    patientId: VALID_UUID,
    goals: [makeGoal()],
    phases: [makePhase()],
    resources: '<p>Recursos recomendados</p>',
    successCriteria: '<p>Criterios de sucesso</p>',
  };

  it('accepts a full valid input', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it('accepts input with null resources and successCriteria', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      resources: null,
      successCriteria: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts input with empty goals and phases arrays', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      goals: [],
      phases: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects input with missing patientId', () => {
    const { patientId: _patientId, ...rest } = VALID_INPUT;
    void _patientId;
    const result = upsertTreatmentPlanInputSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects input with invalid patientId (not UUID)', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      patientId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when a nested goal is invalid', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      goals: [makeGoal({ description: '' })],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when a nested phase is invalid', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      phases: [makePhase({ title: '' })],
    });
    expect(result.success).toBe(false);
  });

  it('rejects resources exceeding 50_000 chars', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      resources: 'x'.repeat(50_001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects successCriteria exceeding 50_000 chars', () => {
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      successCriteria: 'x'.repeat(50_001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects goals array exceeding 100 items', () => {
    const goals = Array.from({ length: 101 }, (_, i) =>
      makeGoal({ id: `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`, order: i }),
    );
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      goals,
    });
    expect(result.success).toBe(false);
  });

  it('rejects phases array exceeding 100 items', () => {
    const phases = Array.from({ length: 101 }, (_, i) =>
      makePhase({ id: `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`, order: i }),
    );
    const result = upsertTreatmentPlanInputSchema.safeParse({
      ...VALID_INPUT,
      phases,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getTreatmentPlanInputSchema
// ---------------------------------------------------------------------------

describe('getTreatmentPlanInputSchema', () => {
  it('accepts a valid patientId', () => {
    const result = getTreatmentPlanInputSchema.safeParse({ patientId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects missing patientId', () => {
    const result = getTreatmentPlanInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid patientId', () => {
    const result = getTreatmentPlanInputSchema.safeParse({ patientId: 'bad' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listTreatmentPlanVersionsInputSchema
// ---------------------------------------------------------------------------

describe('listTreatmentPlanVersionsInputSchema', () => {
  it('accepts a valid planId', () => {
    const result = listTreatmentPlanVersionsInputSchema.safeParse({ planId: VALID_UUID_2 });
    expect(result.success).toBe(true);
  });

  it('rejects missing planId', () => {
    const result = listTreatmentPlanVersionsInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid planId', () => {
    const result = listTreatmentPlanVersionsInputSchema.safeParse({ planId: 'xyz' });
    expect(result.success).toBe(false);
  });
});
