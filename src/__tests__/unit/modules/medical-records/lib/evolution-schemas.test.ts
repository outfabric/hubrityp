import { describe, expect, it } from 'vitest';

import {
  abaContentSchema,
  createEvolutionInputSchema,
  customContentSchema,
  livreContentSchema,
  psicanaliseContentSchema,
  sistemicaContentSchema,
  tccContentSchema,
  updateEvolutionInputSchema,
} from '@/modules/medical-records/lib/evolution-schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FieldErrorRecord = Record<string, string[] | undefined>;

function fieldErrorsOf(result: {
  success: boolean;
  error?: { flatten(): { fieldErrors: FieldErrorRecord } };
}): FieldErrorRecord {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('expected failure');
  return result.error!.flatten().fieldErrors;
}

// ---------------------------------------------------------------------------
// tccContentSchema
// ---------------------------------------------------------------------------

describe('tccContentSchema', () => {
  const VALID_TCC = {
    humor_inicial: 5,
    humor_final: 7,
    pauta_sessao: '<p>Pauta da sessão</p>',
    conteudo_trabalhado: '<p>Conteúdo trabalhado</p>',
    tarefa_casa_atribuida: '<p>Tarefa atribuída</p>',
    tarefa_anterior_status: 'sim' as const,
    proximos_passos: '<p>Próximos passos</p>',
  };

  it('accepts a valid TCC payload', () => {
    const result = tccContentSchema.safeParse(VALID_TCC);
    expect(result.success).toBe(true);
  });

  it('rejects when humor_inicial is missing', () => {
    const payload = {
      humor_final: VALID_TCC.humor_final,
      pauta_sessao: VALID_TCC.pauta_sessao,
      conteudo_trabalhado: VALID_TCC.conteudo_trabalhado,
      tarefa_casa_atribuida: VALID_TCC.tarefa_casa_atribuida,
      tarefa_anterior_status: VALID_TCC.tarefa_anterior_status,
      proximos_passos: VALID_TCC.proximos_passos,
    };
    const result = tccContentSchema.safeParse(payload);
    const errors = fieldErrorsOf(result);
    expect(errors.humor_inicial).toBeDefined();
    expect(errors.humor_inicial![0]).toContain('humor_inicial');
  });

  it('rejects humor_inicial below 0', () => {
    const result = tccContentSchema.safeParse({ ...VALID_TCC, humor_inicial: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects humor_inicial above 10', () => {
    const result = tccContentSchema.safeParse({ ...VALID_TCC, humor_inicial: 11 });
    expect(result.success).toBe(false);
  });

  it('rejects humor_final below 0', () => {
    const result = tccContentSchema.safeParse({ ...VALID_TCC, humor_final: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects humor_final above 10', () => {
    const result = tccContentSchema.safeParse({ ...VALID_TCC, humor_final: 11 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tarefa_anterior_status', () => {
    const result = tccContentSchema.safeParse({
      ...VALID_TCC,
      tarefa_anterior_status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty pauta_sessao', () => {
    const result = tccContentSchema.safeParse({ ...VALID_TCC, pauta_sessao: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// psicanaliseContentSchema
// ---------------------------------------------------------------------------

describe('psicanaliseContentSchema', () => {
  const VALID = {
    conteudo_manifesto: '<p>Conteúdo manifesto</p>',
    associacoes_livres: '<p>Associações livres</p>',
    sonhos_relatados: '<p>Sonhos relatados</p>',
    transferencia_observada: '<p>Transferência observada</p>',
  };

  it('accepts a valid payload', () => {
    expect(psicanaliseContentSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects when conteudo_manifesto is missing', () => {
    const payload = {
      associacoes_livres: VALID.associacoes_livres,
      sonhos_relatados: VALID.sonhos_relatados,
      transferencia_observada: VALID.transferencia_observada,
    };
    const result = psicanaliseContentSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects empty associacoes_livres', () => {
    const result = psicanaliseContentSchema.safeParse({ ...VALID, associacoes_livres: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sistemicaContentSchema
// ---------------------------------------------------------------------------

describe('sistemicaContentSchema', () => {
  const VALID = {
    participantes: ['Pai', 'Mãe', 'Filho'],
    conteudo_trabalhado: '<p>Dinâmica familiar</p>',
    padroes_observados: '<p>Padrões</p>',
    intervencao_realizada: '<p>Intervenção</p>',
    tarefa_casa: '<p>Tarefa</p>',
  };

  it('accepts a valid payload', () => {
    expect(sistemicaContentSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects empty participantes array', () => {
    const result = sistemicaContentSchema.safeParse({ ...VALID, participantes: [] });
    expect(result.success).toBe(false);
  });

  it('rejects participantes with empty strings', () => {
    const result = sistemicaContentSchema.safeParse({ ...VALID, participantes: [''] });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// abaContentSchema
// ---------------------------------------------------------------------------

describe('abaContentSchema', () => {
  const VALID = {
    comportamentos_alvo: '<p>Comportamentos alvo</p>',
    linha_base: '<p>Linha base</p>',
    abc: '<p>Antecedente-Comportamento-Consequência</p>',
    reforcadores: '<p>Reforçadores</p>',
    foco_proxima: '<p>Foco próxima sessão</p>',
  };

  it('accepts a valid payload', () => {
    expect(abaContentSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects missing comportamentos_alvo', () => {
    const payload = {
      linha_base: VALID.linha_base,
      abc: VALID.abc,
      reforcadores: VALID.reforcadores,
      foco_proxima: VALID.foco_proxima,
    };
    expect(abaContentSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects empty abc field', () => {
    expect(abaContentSchema.safeParse({ ...VALID, abc: '' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// livreContentSchema
// ---------------------------------------------------------------------------

describe('livreContentSchema', () => {
  it('accepts a single conteudo field', () => {
    const result = livreContentSchema.safeParse({ conteudo: '<p>Texto livre</p>' });
    expect(result.success).toBe(true);
  });

  it('rejects missing conteudo', () => {
    const result = livreContentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty conteudo', () => {
    const result = livreContentSchema.safeParse({ conteudo: '' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// customContentSchema
// ---------------------------------------------------------------------------

describe('customContentSchema', () => {
  it('accepts a non-empty object', () => {
    const result = customContentSchema.safeParse({ campo1: 'valor1', campo2: 42 });
    expect(result.success).toBe(true);
  });

  it('rejects an empty object', () => {
    const result = customContentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts deeply nested content', () => {
    const result = customContentSchema.safeParse({
      section: { nested: { deep: true } },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createEvolutionInputSchema
// ---------------------------------------------------------------------------

describe('createEvolutionInputSchema', () => {
  const VALID = {
    patientId: '550e8400-e29b-41d4-a716-446655440000',
    templateType: 'tcc' as const,
    content: { humor_inicial: 5 },
  };

  it('accepts a valid create input', () => {
    expect(createEvolutionInputSchema.safeParse(VALID).success).toBe(true);
  });

  it('accepts with optional sessionId', () => {
    const result = createEvolutionInputSchema.safeParse({
      ...VALID,
      sessionId: '660e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid patientId (not UUID)', () => {
    const result = createEvolutionInputSchema.safeParse({ ...VALID, patientId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid templateType', () => {
    const result = createEvolutionInputSchema.safeParse({ ...VALID, templateType: 'invalid' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateEvolutionInputSchema
// ---------------------------------------------------------------------------

describe('updateEvolutionInputSchema', () => {
  const VALID = {
    evolutionId: '550e8400-e29b-41d4-a716-446655440000',
    content: { conteudo: '<p>Texto</p>' },
  };

  it('accepts a valid update without addendum', () => {
    const result = updateEvolutionInputSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it('accepts an addendum with reason', () => {
    const result = updateEvolutionInputSchema.safeParse({
      ...VALID,
      isAddendum: true,
      reason: 'Correção de informação clínica.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an addendum without reason', () => {
    const result = updateEvolutionInputSchema.safeParse({
      ...VALID,
      isAddendum: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an addendum with empty reason', () => {
    const result = updateEvolutionInputSchema.safeParse({
      ...VALID,
      isAddendum: true,
      reason: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid evolutionId', () => {
    const result = updateEvolutionInputSchema.safeParse({
      ...VALID,
      evolutionId: 'bad-id',
    });
    expect(result.success).toBe(false);
  });

  it('defaults isAddendum to false when not provided', () => {
    const result = updateEvolutionInputSchema.safeParse(VALID);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isAddendum).toBe(false);
  });
});
