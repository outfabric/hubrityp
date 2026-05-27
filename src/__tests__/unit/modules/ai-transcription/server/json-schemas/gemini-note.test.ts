import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// The module under test (`gemini-note.ts`) imports `server-only`, which we
// stub in the test environment. It also runs `assertRequiredKeysPresent` at
// module evaluation time, so dynamic imports are used throughout so we can
// control the import order after mocking.
// ---------------------------------------------------------------------------

describe('GeminiNoteJsonSchema', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // ---- Shape assertions ---------------------------------------------------

  it('does not contain a $schema key (Gemini rejects it)', async () => {
    const { GeminiNoteJsonSchema } =
      await import('@/modules/ai-transcription/server/json-schemas/gemini-note');

    expect(GeminiNoteJsonSchema).not.toHaveProperty('$schema');
  });

  it('is a valid JSON Schema object type with all GeneratedNoteSchema fields', async () => {
    const { GeminiNoteJsonSchema } =
      await import('@/modules/ai-transcription/server/json-schemas/gemini-note');

    expect(GeminiNoteJsonSchema['type']).toBe('object');

    const properties = GeminiNoteJsonSchema['properties'] as Record<string, unknown>;
    expect(properties).toBeDefined();

    const expectedKeys = [
      'schemaVersion',
      'humorInicial',
      'humorFinal',
      'pauta',
      'conteudoTrabalhado',
      'tarefaCasa',
      'palavrasRisco',
      'observacoesExtras',
    ];

    for (const key of expectedKeys) {
      expect(properties).toHaveProperty(key);
    }
  });

  it('marks critical fields as required', async () => {
    const { GeminiNoteJsonSchema } =
      await import('@/modules/ai-transcription/server/json-schemas/gemini-note');

    const required = GeminiNoteJsonSchema['required'] as string[];

    expect(required).toContain('schemaVersion');
    expect(required).toContain('pauta');
    expect(required).toContain('conteudoTrabalhado');
    expect(required).toContain('tarefaCasa');
    expect(required).toContain('palavrasRisco');
  });

  it('disallows additional properties', async () => {
    const { GeminiNoteJsonSchema } =
      await import('@/modules/ai-transcription/server/json-schemas/gemini-note');

    expect(GeminiNoteJsonSchema['additionalProperties']).toBe(false);
  });

  // ---- Stability (idempotent / cached) ------------------------------------

  it('returns a stable schema across two imports (deep equal)', async () => {
    const mod1 = await import('@/modules/ai-transcription/server/json-schemas/gemini-note');
    const schema1 = mod1.GeminiNoteJsonSchema;

    // Reset modules so the second import triggers a fresh module evaluation.
    vi.resetModules();

    const mod2 = await import('@/modules/ai-transcription/server/json-schemas/gemini-note');
    const schema2 = mod2.GeminiNoteJsonSchema;

    expect(schema1).toEqual(schema2);
  });

  // ---- Boot-time sanity check throws on drift -----------------------------

  it('throws at module load when a required field is missing from the Zod schema', async () => {
    // Mock the schemas module to return a GeneratedNoteSchema without `palavrasRisco`.
    const { z } = await import('zod');

    const MutilatedSchema = z.object({
      schemaVersion: z.literal(1),
      humorInicial: z.string().nullable(),
      humorFinal: z.string().nullable(),
      pauta: z.array(z.string()),
      conteudoTrabalhado: z.array(z.string()),
      tarefaCasa: z.array(z.string()),
      // `palavrasRisco` deliberately removed
      observacoesExtras: z.string().nullable(),
    });

    vi.doMock('@/modules/ai-transcription/lib/schemas', () => ({
      GeneratedNoteSchema: MutilatedSchema,
    }));

    await expect(
      import('@/modules/ai-transcription/server/json-schemas/gemini-note'),
    ).rejects.toThrow(/required keys missing.*palavrasRisco/);
  });
});
