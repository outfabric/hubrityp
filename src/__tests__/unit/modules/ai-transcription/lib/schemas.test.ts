import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  GeneratedNoteSchema,
  RiskAlertSchema,
  TranscriptionIdSchema,
  type TranscriptionId,
} from '@/modules/ai-transcription';

// ---------------------------------------------------------------------------
// Canonical valid payloads
// ---------------------------------------------------------------------------

const VALID_GENERATED_NOTE = {
  schemaVersion: 1 as const,
  humorInicial: 'ansioso',
  humorFinal: 'calmo',
  pauta: ['ansiedade social', 'conflito familiar'],
  conteudoTrabalhado: ['reestruturação cognitiva'],
  tarefaCasa: ['registrar pensamentos automáticos'],
  palavrasRisco: [],
  observacoesExtras: null,
};

const VALID_RISK_ALERT = {
  kind: 'suicidal' as const,
  excerpt: 'Paciente mencionou pensamentos de morte.',
  confidence: 'high' as const,
};

// ---------------------------------------------------------------------------
// GeneratedNoteSchema
// ---------------------------------------------------------------------------

describe('GeneratedNoteSchema', () => {
  it('(a) accepts a valid payload', () => {
    const result = GeneratedNoteSchema.safeParse(VALID_GENERATED_NOTE);
    expect(result.success).toBe(true);
  });

  it('(b) rejects missing schemaVersion', () => {
    const result = GeneratedNoteSchema.safeParse({
      humorInicial: VALID_GENERATED_NOTE.humorInicial,
      humorFinal: VALID_GENERATED_NOTE.humorFinal,
      pauta: VALID_GENERATED_NOTE.pauta,
      conteudoTrabalhado: VALID_GENERATED_NOTE.conteudoTrabalhado,
      tarefaCasa: VALID_GENERATED_NOTE.tarefaCasa,
      palavrasRisco: VALID_GENERATED_NOTE.palavrasRisco,
      observacoesExtras: VALID_GENERATED_NOTE.observacoesExtras,
    });
    expect(result.success).toBe(false);
  });

  it('(c) rejects schemaVersion: 2', () => {
    const result = GeneratedNoteSchema.safeParse({
      ...VALID_GENERATED_NOTE,
      schemaVersion: 2,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RiskAlertSchema
// ---------------------------------------------------------------------------

describe('RiskAlertSchema', () => {
  it('(d) rejects unknown kind', () => {
    const result = RiskAlertSchema.safeParse({
      ...VALID_RISK_ALERT,
      kind: 'unknown_risk',
    });
    expect(result.success).toBe(false);
  });

  it('(e) rejects excerpt longer than 500 characters', () => {
    const result = RiskAlertSchema.safeParse({
      ...VALID_RISK_ALERT,
      excerpt: 'A'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('accepts excerpt of exactly 500 characters', () => {
    const result = RiskAlertSchema.safeParse({
      ...VALID_RISK_ALERT,
      excerpt: 'A'.repeat(500),
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TranscriptionId branded type
// ---------------------------------------------------------------------------

describe('TranscriptionId branded type', () => {
  it('(f) cannot be assigned from a raw string at the type level', () => {
    // A raw `string` should NOT be assignable to `TranscriptionId`.
    expectTypeOf<string>().not.toMatchTypeOf<TranscriptionId>();

    // A parsed `TranscriptionId` IS assignable to itself.
    const parsed = TranscriptionIdSchema.parse('550e8400-e29b-41d4-a716-446655440000');
    expectTypeOf(parsed).toMatchTypeOf<TranscriptionId>();
  });
});
