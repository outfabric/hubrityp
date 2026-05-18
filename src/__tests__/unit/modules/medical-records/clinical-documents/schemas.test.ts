import { describe, expect, it } from 'vitest';

import {
  atestadoContentSchema,
  baseDocumentContentSchema,
  computeReferencesCid10,
  createDocumentInputSchema,
  declaracaoContentSchema,
  documentContentSchema,
  documentTypeSchema,
  finalizeDocumentInputSchema,
  laudoContentSchema,
  parecerContentSchema,
  relatorioContentSchema,
  updateDocumentInputSchema,
} from '@/modules/medical-records/lib/schemas/clinical-documents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PATIENT_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_DOCUMENT_ID = '660e8400-e29b-41d4-a716-446655440000';

/** Minimal valid base content (shared by all document types). */
function makeBaseContent() {
  return {
    solicitante: 'Tribunal Regional do Trabalho',
    psychologistInfo: {
      name: 'Dra. Ana Silva',
      crp: '06/123456',
    },
    demanda: 'Avaliação psicológica para fins judiciais.',
    procedimentos: 'Entrevistas clínicas, aplicação do WAIS-IV.',
    conclusao: 'O periciado apresenta capacidade cognitiva preservada.',
    localData: {
      local: 'São Paulo, SP',
      data: '2026-05-18',
    },
  };
}

// ---------------------------------------------------------------------------
// documentTypeSchema
// ---------------------------------------------------------------------------

describe('documentTypeSchema', () => {
  it.each(['declaracao', 'atestado', 'relatorio', 'laudo', 'parecer'] as const)(
    'accepts valid type "%s"',
    (type) => {
      expect(documentTypeSchema.safeParse(type).success).toBe(true);
    },
  );

  it('rejects an invalid document type', () => {
    expect(documentTypeSchema.safeParse('receita').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(documentTypeSchema.safeParse('').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// baseDocumentContentSchema
// ---------------------------------------------------------------------------

describe('baseDocumentContentSchema', () => {
  it('accepts valid base content', () => {
    const result = baseDocumentContentSchema.safeParse(makeBaseContent());
    expect(result.success).toBe(true);
  });

  it('defaults cid10Codes to empty array when omitted', () => {
    const result = baseDocumentContentSchema.safeParse(makeBaseContent());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cid10Codes).toEqual([]);
    }
  });

  it('accepts cid10Codes with valid entries', () => {
    const content = {
      ...makeBaseContent(),
      cid10Codes: [{ code: 'F32.0', description: 'Episódio depressivo leve' }],
    };
    const result = baseDocumentContentSchema.safeParse(content);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cid10Codes).toHaveLength(1);
    }
  });

  it('rejects cid10Codes entry with empty code', () => {
    const content = {
      ...makeBaseContent(),
      cid10Codes: [{ code: '', description: 'Episódio depressivo leve' }],
    };
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects cid10Codes entry with empty description', () => {
    const content = {
      ...makeBaseContent(),
      cid10Codes: [{ code: 'F32.0', description: '' }],
    };
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });

  it.each(['solicitante', 'demanda', 'procedimentos', 'conclusao'] as const)(
    'rejects when %s is missing',
    (field) => {
      const content = makeBaseContent();
      delete (content as Record<string, unknown>)[field];
      expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
    },
  );

  it.each(['solicitante', 'demanda', 'procedimentos', 'conclusao'] as const)(
    'rejects when %s is an empty string',
    (field) => {
      const content = { ...makeBaseContent(), [field]: '' };
      expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
    },
  );

  it('rejects when localData is missing', () => {
    const content = makeBaseContent();
    delete (content as Record<string, unknown>)['localData'];
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects when localData.local is empty', () => {
    const content = { ...makeBaseContent(), localData: { local: '', data: '2026-05-18' } };
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects when localData.data is empty', () => {
    const content = { ...makeBaseContent(), localData: { local: 'São Paulo', data: '' } };
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects when psychologistInfo is missing', () => {
    const content = makeBaseContent();
    delete (content as Record<string, unknown>)['psychologistInfo'];
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects when psychologistInfo.name is empty', () => {
    const content = {
      ...makeBaseContent(),
      psychologistInfo: { name: '', crp: '06/123456' },
    };
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects when psychologistInfo.crp is empty', () => {
    const content = {
      ...makeBaseContent(),
      psychologistInfo: { name: 'Dra. Ana Silva', crp: '' },
    };
    expect(baseDocumentContentSchema.safeParse(content).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// declaracaoContentSchema
// ---------------------------------------------------------------------------

describe('declaracaoContentSchema', () => {
  it('accepts valid declaracao without analise', () => {
    const content = { ...makeBaseContent(), document_type: 'declaracao' as const };
    const result = declaracaoContentSchema.safeParse(content);
    expect(result.success).toBe(true);
  });

  it('does not require analise field', () => {
    const content = { ...makeBaseContent(), document_type: 'declaracao' as const };
    // analise is not present — should succeed
    expect(declaracaoContentSchema.safeParse(content).success).toBe(true);
  });

  it('strips unknown fields (analise is not in the schema)', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'declaracao' as const,
      analise: 'some analysis',
    };
    const result = declaracaoContentSchema.safeParse(content);
    expect(result.success).toBe(true);
    if (result.success) {
      // analise is not part of declaracao schema, Zod strips it
      expect('analise' in result.data).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// atestadoContentSchema
// ---------------------------------------------------------------------------

describe('atestadoContentSchema', () => {
  it('accepts valid atestado without period/validity', () => {
    const content = { ...makeBaseContent(), document_type: 'atestado' as const };
    expect(atestadoContentSchema.safeParse(content).success).toBe(true);
  });

  it('accepts atestado with period and validity', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'atestado' as const,
      period: '15 dias',
      validity: '30 dias',
    };
    const result = atestadoContentSchema.safeParse(content);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe('15 dias');
      expect(result.data.validity).toBe('30 dias');
    }
  });

  it('accepts atestado with only period', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'atestado' as const,
      period: '7 dias',
    };
    expect(atestadoContentSchema.safeParse(content).success).toBe(true);
  });

  it('accepts atestado with only validity', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'atestado' as const,
      validity: '60 dias',
    };
    expect(atestadoContentSchema.safeParse(content).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// relatorioContentSchema
// ---------------------------------------------------------------------------

describe('relatorioContentSchema', () => {
  it('accepts valid relatorio with analise', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'relatorio' as const,
      analise: 'Análise detalhada dos dados coletados.',
    };
    expect(relatorioContentSchema.safeParse(content).success).toBe(true);
  });

  it('rejects relatorio without analise', () => {
    const content = { ...makeBaseContent(), document_type: 'relatorio' as const };
    expect(relatorioContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects relatorio with empty analise', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'relatorio' as const,
      analise: '',
    };
    expect(relatorioContentSchema.safeParse(content).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// laudoContentSchema
// ---------------------------------------------------------------------------

describe('laudoContentSchema', () => {
  it('accepts valid laudo with analise', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'laudo' as const,
      analise: 'Análise aprofundada dos fatos e evidências clínicas.',
    };
    expect(laudoContentSchema.safeParse(content).success).toBe(true);
  });

  it('rejects laudo without analise', () => {
    const content = { ...makeBaseContent(), document_type: 'laudo' as const };
    expect(laudoContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects laudo with empty analise', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'laudo' as const,
      analise: '',
    };
    expect(laudoContentSchema.safeParse(content).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parecerContentSchema
// ---------------------------------------------------------------------------

describe('parecerContentSchema', () => {
  it('accepts valid parecer with analise', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'parecer' as const,
      analise: 'Opinião técnica fundamentada sobre o caso.',
    };
    expect(parecerContentSchema.safeParse(content).success).toBe(true);
  });

  it('rejects parecer without analise', () => {
    const content = { ...makeBaseContent(), document_type: 'parecer' as const };
    expect(parecerContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects parecer with empty analise', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'parecer' as const,
      analise: '',
    };
    expect(parecerContentSchema.safeParse(content).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// documentContentSchema (discriminated union)
// ---------------------------------------------------------------------------

describe('documentContentSchema (discriminated union)', () => {
  it('dispatches declaracao correctly', () => {
    const content = { ...makeBaseContent(), document_type: 'declaracao' as const };
    expect(documentContentSchema.safeParse(content).success).toBe(true);
  });

  it('dispatches laudo correctly — accepts with analise', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'laudo' as const,
      analise: 'Análise completa.',
    };
    expect(documentContentSchema.safeParse(content).success).toBe(true);
  });

  it('dispatches laudo correctly — rejects without analise', () => {
    const content = { ...makeBaseContent(), document_type: 'laudo' as const };
    expect(documentContentSchema.safeParse(content).success).toBe(false);
  });

  it('dispatches atestado correctly — accepts with period/validity', () => {
    const content = {
      ...makeBaseContent(),
      document_type: 'atestado' as const,
      period: '10 dias',
      validity: '30 dias',
    };
    expect(documentContentSchema.safeParse(content).success).toBe(true);
  });

  it('rejects unknown document_type', () => {
    const content = { ...makeBaseContent(), document_type: 'receita' };
    expect(documentContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects missing document_type', () => {
    expect(documentContentSchema.safeParse(makeBaseContent()).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createDocumentInputSchema
// ---------------------------------------------------------------------------

describe('createDocumentInputSchema', () => {
  it('accepts valid input with minimal fields', () => {
    const result = createDocumentInputSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      document_type: 'laudo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('');
      expect(result.data.content).toBeUndefined();
    }
  });

  it('accepts valid input with all fields', () => {
    const result = createDocumentInputSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      document_type: 'parecer',
      title: 'Parecer técnico - caso 123',
      content: { solicitante: 'Vara de Família' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid patientId', () => {
    expect(
      createDocumentInputSchema.safeParse({
        patientId: 'not-a-uuid',
        document_type: 'laudo',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid document_type', () => {
    expect(
      createDocumentInputSchema.safeParse({
        patientId: VALID_PATIENT_ID,
        document_type: 'receita',
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateDocumentInputSchema
// ---------------------------------------------------------------------------

describe('updateDocumentInputSchema', () => {
  it('accepts valid input with title only', () => {
    const result = updateDocumentInputSchema.safeParse({
      documentId: VALID_DOCUMENT_ID,
      title: 'Atualização de título',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with content only', () => {
    const result = updateDocumentInputSchema.safeParse({
      documentId: VALID_DOCUMENT_ID,
      content: { solicitante: 'Novo solicitante' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with both title and content', () => {
    const result = updateDocumentInputSchema.safeParse({
      documentId: VALID_DOCUMENT_ID,
      title: 'Novo título',
      content: { demanda: 'Nova demanda' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with only documentId (no changes)', () => {
    const result = updateDocumentInputSchema.safeParse({
      documentId: VALID_DOCUMENT_ID,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid documentId', () => {
    expect(
      updateDocumentInputSchema.safeParse({
        documentId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// finalizeDocumentInputSchema
// ---------------------------------------------------------------------------

describe('finalizeDocumentInputSchema', () => {
  it('accepts valid input with consent confirmed', () => {
    const result = finalizeDocumentInputSchema.safeParse({
      documentId: VALID_DOCUMENT_ID,
      cid10ConsentConfirmed: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cid10ConsentConfirmed).toBe(true);
    }
  });

  it('defaults cid10ConsentConfirmed to false when omitted', () => {
    const result = finalizeDocumentInputSchema.safeParse({
      documentId: VALID_DOCUMENT_ID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cid10ConsentConfirmed).toBe(false);
    }
  });

  it('rejects invalid documentId', () => {
    expect(
      finalizeDocumentInputSchema.safeParse({
        documentId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeReferencesCid10
// ---------------------------------------------------------------------------

describe('computeReferencesCid10', () => {
  it('returns true when cid10Codes has entries', () => {
    const content = {
      cid10Codes: [{ code: 'F32.0', description: 'Episódio depressivo leve' }],
    };
    expect(computeReferencesCid10(content)).toBe(true);
  });

  it('returns true with multiple CID-10 entries', () => {
    const content = {
      cid10Codes: [
        { code: 'F32.0', description: 'Episódio depressivo leve' },
        { code: 'F41.1', description: 'Ansiedade generalizada' },
      ],
    };
    expect(computeReferencesCid10(content)).toBe(true);
  });

  it('returns false when cid10Codes is an empty array', () => {
    expect(computeReferencesCid10({ cid10Codes: [] })).toBe(false);
  });

  it('returns false when cid10Codes is absent', () => {
    expect(computeReferencesCid10({ solicitante: 'TRT' })).toBe(false);
  });

  it('returns false when content is null', () => {
    expect(computeReferencesCid10(null)).toBe(false);
  });

  it('returns false when content is undefined', () => {
    expect(computeReferencesCid10(undefined)).toBe(false);
  });

  it('returns false when content is not an object', () => {
    expect(computeReferencesCid10('string')).toBe(false);
    expect(computeReferencesCid10(42)).toBe(false);
    expect(computeReferencesCid10(true)).toBe(false);
  });

  it('returns false when cid10Codes is not an array', () => {
    expect(computeReferencesCid10({ cid10Codes: 'F32.0' })).toBe(false);
    expect(computeReferencesCid10({ cid10Codes: 123 })).toBe(false);
    expect(computeReferencesCid10({ cid10Codes: {} })).toBe(false);
  });
});
