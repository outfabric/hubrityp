import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: Drizzle ORM operators (avoid pulling real SQL builders)
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
}));

// ---------------------------------------------------------------------------
// Mock: schema tables (referenced only as opaque column markers)
// ---------------------------------------------------------------------------

vi.mock('@/shared/db/schema/agenda/tables', () => ({
  sessions: { id: 'sessions.id', userId: 'sessions.user_id' },
}));

vi.mock('@/shared/db/schema/patients/tables', () => ({
  patients: { id: 'patients.id', userId: 'patients.user_id' },
}));

vi.mock('@/shared/db/schema/medical-records/tables', () => ({
  evolutions: {
    id: 'evolutions.id',
    sessionId: 'evolutions.session_id',
    userId: 'evolutions.user_id',
  },
  evolutionVersions: {},
  auditLog: {},
}));

// ---------------------------------------------------------------------------
// Mock: logger (no PII assertions needed here)
// ---------------------------------------------------------------------------

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock: Drizzle DB client
// ---------------------------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbTransaction = vi.fn();

vi.mock('@/shared/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args) as unknown,
    transaction: (...args: unknown[]) => mockDbTransaction(...args) as unknown,
  },
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** A chainable `db.select(...).from(...).where(...).limit(...)` that resolves to `rows`. */
function chainableSelect(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

/** Builds a Supabase client mock whose getUser() returns the given user id. */
function makeSupabase(userId: string | null): SupabaseClient {
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
}

/**
 * Builds a transaction mock that records the `.values()` argument passed to
 * the FIRST `tx.insert(...)` call (the `evolutions` insert) and returns a
 * deterministic evolution id from its `.returning()`. Subsequent inserts
 * (versions, audit log) resolve to `[]`.
 */
function setupTransaction(evolutionId: string) {
  const insertValuesCalls: Array<Record<string, unknown>> = [];

  mockDbTransaction.mockImplementation(
    async (cb: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      let insertCount = 0;
      const tx = {
        // Duplicate-session pre-check: select(...).from(...).where(...).limit(...)
        select: vi.fn().mockReturnValue(chainableSelect([])),
        insert: vi.fn(() => {
          const callIndex = insertCount;
          insertCount += 1;
          return {
            values: vi.fn((arg: Record<string, unknown>) => {
              insertValuesCalls[callIndex] = arg;
              // Only the evolutions insert chains `.returning(...)`.
              return {
                returning: vi.fn().mockResolvedValue([{ id: evolutionId }]),
              };
            }),
          };
        }),
      };
      return cb(tx);
    },
  );

  return insertValuesCalls;
}

// A valid `livre` content payload (single freeform field).
const VALID_LIVRE_CONTENT = { conteudo: 'Sessão correu bem.' };

// ---------------------------------------------------------------------------
// Subject under test (imported after mocks)
// ---------------------------------------------------------------------------

import { createEvolutionImpl } from '@/modules/medical-records/server/create-evolution';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: patient ownership check passes (one row returned).
  mockDbSelect.mockReturnValue(chainableSelect([{ id: 'patient-row' }]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEvolutionImpl — AI-assist flags', () => {
  it('defaults to ai_assisted=false and ai_transcription_id=null when omitted', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const evolutionId = randomUUID();

    mockDbSelect.mockReturnValue(chainableSelect([{ id: patientId }]));
    const insertCalls = setupTransaction(evolutionId);

    const result = await createEvolutionImpl(makeSupabase(userId), {
      patientId,
      templateType: 'livre',
      content: VALID_LIVRE_CONTENT,
    });

    expect(result).toEqual({ ok: true, id: evolutionId });

    const evolutionValues = insertCalls[0]!;
    expect(evolutionValues.aiAssisted).toBe(false);
    expect(evolutionValues.aiTranscriptionId).toBeNull();
  });

  it('persists ai_assisted=true and ai_transcription_id when provided', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const evolutionId = randomUUID();
    const transcriptionId = randomUUID();

    mockDbSelect.mockReturnValue(chainableSelect([{ id: patientId }]));
    const insertCalls = setupTransaction(evolutionId);

    const result = await createEvolutionImpl(makeSupabase(userId), {
      patientId,
      templateType: 'livre',
      content: VALID_LIVRE_CONTENT,
      aiAssisted: true,
      aiTranscriptionId: transcriptionId,
    });

    expect(result).toEqual({ ok: true, id: evolutionId });

    const evolutionValues = insertCalls[0]!;
    expect(evolutionValues.aiAssisted).toBe(true);
    expect(evolutionValues.aiTranscriptionId).toBe(transcriptionId);
  });

  it('rejects an invalid aiTranscriptionId (non-UUID) as INVALID_TEMPLATE', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    const result = await createEvolutionImpl(makeSupabase(userId), {
      patientId,
      templateType: 'livre',
      content: VALID_LIVRE_CONTENT,
      aiAssisted: true,
      aiTranscriptionId: 'not-a-uuid',
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_TEMPLATE' });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Regression: existing createEvolutionImpl behaviour is unchanged
// ---------------------------------------------------------------------------

describe('createEvolutionImpl — existing behaviour preserved', () => {
  it('returns UNAUTHORIZED when there is no authenticated user', async () => {
    const result = await createEvolutionImpl(makeSupabase(null), {
      patientId: randomUUID(),
      templateType: 'livre',
      content: VALID_LIVRE_CONTENT,
    });

    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it('returns INVALID_TEMPLATE for an unknown template type', async () => {
    const result = await createEvolutionImpl(makeSupabase(randomUUID()), {
      patientId: randomUUID(),
      templateType: 'nonexistent',
      content: VALID_LIVRE_CONTENT,
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_TEMPLATE' });
  });

  it('returns INVALID_TEMPLATE when content fails the template content schema', async () => {
    const result = await createEvolutionImpl(makeSupabase(randomUUID()), {
      patientId: randomUUID(),
      templateType: 'livre',
      content: { conteudo: '' }, // empty -> fails min(1)
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_TEMPLATE' });
  });

  it('returns NOT_FOUND when the patient does not belong to the user', async () => {
    mockDbSelect.mockReturnValue(chainableSelect([])); // ownership check returns no row

    const result = await createEvolutionImpl(makeSupabase(randomUUID()), {
      patientId: randomUUID(),
      templateType: 'livre',
      content: VALID_LIVRE_CONTENT,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it('creates an evolution with default flags (happy path, no AI fields)', async () => {
    const evolutionId = randomUUID();
    const insertCalls = setupTransaction(evolutionId);

    const result = await createEvolutionImpl(makeSupabase(randomUUID()), {
      patientId: randomUUID(),
      templateType: 'livre',
      content: VALID_LIVRE_CONTENT,
    });

    expect(result).toEqual({ ok: true, id: evolutionId });
    // evolutions + evolution_versions + audit_log = 3 inserts
    expect(insertCalls.length).toBe(3);
  });
});
