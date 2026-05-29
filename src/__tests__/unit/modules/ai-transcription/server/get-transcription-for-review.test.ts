import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle operator stubs (opaque markers)
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
}));

vi.mock('@/shared/db/schema/agenda/tables', () => ({
  sessions: { id: 'sessions.id', startAt: 'sessions.start_at' },
}));
vi.mock('@/shared/db/schema/ai-transcription/tables', () => ({
  aiTranscriptions: new Proxy({}, { get: (_t, prop) => `ai_transcriptions.${String(prop)}` }),
}));
vi.mock('@/shared/db/schema/patients/tables', () => ({
  patients: { id: 'patients.id', fullName: 'patients.full_name' },
}));

// ---------------------------------------------------------------------------
// Logger spy — capture every log argument so we can assert no PII leaks.
// ---------------------------------------------------------------------------

const logCalls: Array<{ level: string; arg: Record<string, unknown> }> = [];

function spyLog(level: string) {
  return (arg: Record<string, unknown>) => {
    logCalls.push({ level, arg });
  };
}

vi.mock('@/modules/ai-transcription/lib/logger', () => ({
  createTranscriptionLogger: vi.fn(() => ({
    debug: spyLog('debug'),
    info: spyLog('info'),
    warn: spyLog('warn'),
    error: spyLog('error'),
  })),
}));

// ---------------------------------------------------------------------------
// DB mock — a chainable select that resolves to `selectResult`.
// ---------------------------------------------------------------------------

let selectResult: Record<string, unknown>[] = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(selectResult)),
            })),
          })),
        })),
      })),
    })),
  },
}));

// ---------------------------------------------------------------------------
// Subject (imported after mocks)
// ---------------------------------------------------------------------------

import { getTranscriptionForReviewImpl } from '@/modules/ai-transcription/server/get-transcription-for-review';

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
  humorFinal: 'tranquilo',
  pauta: ['ansiedade'],
  conteudoTrabalhado: ['respiração'],
  tarefaCasa: ['diário'],
  palavrasRisco: [],
  observacoesExtras: null,
};

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    status: 'ready',
    source: 'manual_upload',
    templateUsed: 'tcc',
    generatedNote: VALID_NOTE,
    riskAlerts: [],
    savedToProntuario: false,
    evolutionId: null,
    errorCode: null,
    createdAt: new Date(),
    completedAt: null,
    patientId: randomUUID(),
    patientFullName: 'Maria da Silva Santos',
    sessionId: randomUUID(),
    sessionStartAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  logCalls.length = 0;
  selectResult = [];
});

describe('getTranscriptionForReviewImpl', () => {
  it('returns UNAUTHORIZED for an anonymous caller (no DB query)', async () => {
    const result = await getTranscriptionForReviewImpl(makeSupabase(null), {
      transcriptionId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('returns INVALID_INPUT for a non-UUID transcriptionId', async () => {
    const result = await getTranscriptionForReviewImpl(makeSupabase(randomUUID()), {
      transcriptionId: 'not-a-uuid',
    });
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('returns NOT_FOUND for a cross-tenant id (IDOR — query yields no row)', async () => {
    selectResult = []; // B querying A's id: WHERE user_id = B matches nothing
    const result = await getTranscriptionForReviewImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('returns the mapped review payload on the happy path', async () => {
    const row = dbRow();
    selectResult = [row];

    const result = await getTranscriptionForReviewImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transcriptionId).toBe(row.id);
    expect(result.status).toBe('ready');
    expect(result.source).toBe('manual_upload');
    expect(result.patientFirstName).toBe('Maria');
    expect(result.patientId).toBe(row.patientId);
    expect(result.sessionId).toBe(row.sessionId);
    expect(result.generatedNote).toEqual(VALID_NOTE);
    expect(result.riskAlerts).toEqual([]);
  });

  it('logs note_schema_drift and degrades generatedNote to null on drift', async () => {
    const driftedNote = { schemaVersion: 1, pauta: ['x'] }; // missing required fields
    selectResult = [dbRow({ generatedNote: driftedNote })];

    const result = await getTranscriptionForReviewImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.generatedNote).toBeNull();

    const drift = logCalls.find((c) => c.arg.event === 'note_schema_drift');
    expect(drift).toBeDefined();
    // Drift log carries the transcriptionId ONLY — no payload.
    expect(Object.keys(drift!.arg).sort()).toEqual(['event', 'transcriptionId']);
  });

  it('never logs the patient name or note content (PII redaction at the source)', async () => {
    selectResult = [dbRow({ patientFullName: 'Joana Pereira Oliveira' })];

    await getTranscriptionForReviewImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
    });

    const serialized = JSON.stringify(logCalls);
    expect(serialized).not.toContain('Joana');
    expect(serialized).not.toContain('Pereira');
    expect(serialized).not.toContain('respiração');
  });
});
