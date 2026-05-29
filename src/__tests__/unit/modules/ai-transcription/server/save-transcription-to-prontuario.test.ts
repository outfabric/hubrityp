import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle operator stubs
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  inArray: (col: unknown, values: unknown[]) => ({ type: 'inArray', col, values }),
}));

vi.mock('@/shared/db/schema/ai-transcription/tables', () => ({
  aiTranscriptions: new Proxy({}, { get: (_t, prop) => `ai_transcriptions.${String(prop)}` }),
}));

vi.mock('@/modules/ai-transcription/lib/logger', () => ({
  createTranscriptionLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Consent helper is exercised in integration tests against real consent rows;
// here it always reports active so the save path proceeds.
const assertAiConsentActiveMock = vi.fn();
vi.mock('@/modules/ai-transcription/lib/consent', () => ({
  assertAiConsentActive: (...args: unknown[]) => assertAiConsentActiveMock(...args) as unknown,
}));

// ---------------------------------------------------------------------------
// createEvolutionImpl mock
// ---------------------------------------------------------------------------

const createEvolutionImplMock = vi.fn();

vi.mock('@/modules/medical-records', () => ({
  createEvolutionImpl: (...args: unknown[]) => createEvolutionImplMock(...args) as unknown,
}));

// ---------------------------------------------------------------------------
// DB mock — select then update
// ---------------------------------------------------------------------------

let selectResult: Record<string, unknown>[] = [];
let updateReturning: Array<{ id: string }> = [];
const updateSetCalls: Array<Record<string, unknown>> = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectResult)),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((setValues: Record<string, unknown>) => {
        updateSetCalls.push(setValues);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve(updateReturning)),
          })),
        };
      }),
    })),
  },
}));

import { saveTranscriptionToProntuarioImpl } from '@/modules/ai-transcription/server/save-transcription-to-prontuario';

function makeSupabase(userId: string | null): SupabaseClient {
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
}

const VALID_NOTE = {
  schemaVersion: 1,
  humorInicial: 'ansioso',
  humorFinal: 'calmo',
  pauta: ['ansiedade'],
  conteudoTrabalhado: ['exposição'],
  tarefaCasa: ['diário'],
  palavrasRisco: [],
  observacoesExtras: null,
};

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    patientId: randomUUID(),
    sessionId: randomUUID(),
    generatedNote: VALID_NOTE,
    savedToProntuario: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = [];
  updateReturning = [];
  updateSetCalls.length = 0;
  createEvolutionImplMock.mockReset();
  assertAiConsentActiveMock.mockReset();
  assertAiConsentActiveMock.mockResolvedValue({ ok: true });
});

describe('saveTranscriptionToProntuarioImpl', () => {
  it('rejects reviewedChecked=false with MUST_REVIEW and no DB access', async () => {
    const result = await saveTranscriptionToProntuarioImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
      reviewedChecked: false,
    });
    expect(result).toEqual({ ok: false, code: 'MUST_REVIEW' });
    expect(createEvolutionImplMock).not.toHaveBeenCalled();
  });

  it('returns UNAUTHORIZED for an anonymous caller', async () => {
    const result = await saveTranscriptionToProntuarioImpl(makeSupabase(null), {
      transcriptionId: randomUUID(),
      reviewedChecked: true,
    });
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('returns NOT_FOUND for a cross-tenant id (no row matches owner scope)', async () => {
    selectResult = [];
    const result = await saveTranscriptionToProntuarioImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
      reviewedChecked: true,
    });
    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(createEvolutionImplMock).not.toHaveBeenCalled();
  });

  it('returns ALREADY_SAVED when the row is already saved', async () => {
    selectResult = [readyRow({ savedToProntuario: true })];
    const result = await saveTranscriptionToProntuarioImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
      reviewedChecked: true,
    });
    expect(result).toEqual({ ok: false, code: 'ALREADY_SAVED' });
    expect(createEvolutionImplMock).not.toHaveBeenCalled();
  });

  it('creates a flagged evolution and marks the row saved on the happy path', async () => {
    const transcriptionId = randomUUID();
    const evolutionId = randomUUID();
    const row = readyRow();
    selectResult = [row];
    updateReturning = [{ id: row.id }];
    createEvolutionImplMock.mockResolvedValue({ ok: true, id: evolutionId });

    const result = await saveTranscriptionToProntuarioImpl(makeSupabase(randomUUID()), {
      transcriptionId,
      reviewedChecked: true,
    });

    expect(result).toEqual({ ok: true, evolutionId });

    // createEvolutionImpl invoked with the AI-assist flags + backlink.
    const [, evoInput] = createEvolutionImplMock.mock.calls[0]!;
    expect(evoInput).toMatchObject({
      patientId: row.patientId,
      sessionId: row.sessionId,
      templateType: 'livre',
      aiAssisted: true,
      aiTranscriptionId: transcriptionId,
    });
    expect((evoInput as { content: { conteudo: string } }).content.conteudo).toContain(
      'Nota gerada por IA',
    );

    // The transcription UPDATE sets reviewed+saved+evolution backlink.
    const setValues = updateSetCalls[0]!;
    expect(setValues).toMatchObject({
      status: 'reviewed',
      savedToProntuario: true,
      evolutionId,
    });
  });

  it('returns SAVE_FAILED and does NOT mark the row when createEvolutionImpl fails', async () => {
    selectResult = [readyRow()];
    createEvolutionImplMock.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });

    const result = await saveTranscriptionToProntuarioImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
      reviewedChecked: true,
    });

    expect(result).toEqual({ ok: false, code: 'SAVE_FAILED' });
    // No UPDATE issued — the transcription row is untouched (no partial state).
    expect(updateSetCalls.length).toBe(0);
  });

  it('propagates a thrown createEvolutionImpl (transaction rollback semantics)', async () => {
    selectResult = [readyRow()];
    createEvolutionImplMock.mockRejectedValue(new Error('db down'));

    await expect(
      saveTranscriptionToProntuarioImpl(makeSupabase(randomUUID()), {
        transcriptionId: randomUUID(),
        reviewedChecked: true,
      }),
    ).rejects.toThrow('db down');

    // The transcription row was never updated.
    expect(updateSetCalls.length).toBe(0);
  });
});
