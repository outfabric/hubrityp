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
  sql: Object.assign((...args: unknown[]) => ({ type: 'sql', args }), {
    raw: (s: string) => ({ type: 'sql.raw', s }),
  }),
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

// ---------------------------------------------------------------------------
// DB mock — capture the UPDATE `.set()` payload + `.where()` condition.
// ---------------------------------------------------------------------------

let updateReturning: Array<{ id: string }> = [];
const setCalls: Array<Record<string, unknown>> = [];
const whereCalls: unknown[] = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((setValues: Record<string, unknown>) => {
        setCalls.push(setValues);
        return {
          where: vi.fn((cond: unknown) => {
            whereCalls.push(cond);
            return {
              returning: vi.fn(() => Promise.resolve(updateReturning)),
            };
          }),
        };
      }),
    })),
  },
}));

import { updateTranscriptionDraftImpl } from '@/modules/ai-transcription/server/update-transcription-draft';

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
  humorInicial: 'ok',
  humorFinal: 'ok',
  pauta: ['p'],
  conteudoTrabalhado: ['c'],
  tarefaCasa: [],
  palavrasRisco: [],
  observacoesExtras: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  updateReturning = [];
  setCalls.length = 0;
  whereCalls.length = 0;
});

describe('updateTranscriptionDraftImpl', () => {
  it('returns UNAUTHORIZED for an anonymous caller', async () => {
    const result = await updateTranscriptionDraftImpl(makeSupabase(null), {
      transcriptionId: randomUUID(),
      generatedNote: VALID_NOTE,
    });
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('returns INVALID_INPUT when generatedNote fails the schema', async () => {
    const result = await updateTranscriptionDraftImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
      generatedNote: { schemaVersion: 1 }, // missing fields
    });
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('increments user_edits_count and returns savedAt on success', async () => {
    updateReturning = [{ id: randomUUID() }];

    const result = await updateTranscriptionDraftImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
      generatedNote: VALID_NOTE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.savedAt).toBeInstanceOf(Date);

    // The SET clause increments the edit counter via a sql expression.
    const setValues = setCalls[0]!;
    expect(setValues.userEditsCount).toEqual({
      type: 'sql',
      args: expect.arrayContaining(['ai_transcriptions.userEditsCount']),
    });
    expect(setValues.generatedNote).toEqual(VALID_NOTE);
  });

  it("returns NOT_EDITABLE when status is 'pending' (0 rows affected)", async () => {
    updateReturning = []; // status predicate excluded the row

    const result = await updateTranscriptionDraftImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
      generatedNote: VALID_NOTE,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_EDITABLE' });

    // The WHERE clause must scope by the editable-status set.
    const cond = whereCalls[0] as { args: unknown[] };
    const inArrayCond = cond.args.find((c) => (c as { type?: string }).type === 'inArray') as {
      values: string[];
    };
    expect(inArrayCond.values).toEqual(['ready', 'reviewed']);
  });

  it('returns NOT_EDITABLE for a cross-tenant id (IDOR — 0 rows affected)', async () => {
    updateReturning = []; // WHERE user_id = caller matches nothing for foreign id
    const callerId = randomUUID();

    const result = await updateTranscriptionDraftImpl(makeSupabase(callerId), {
      transcriptionId: randomUUID(),
      generatedNote: VALID_NOTE,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_EDITABLE' });

    // Ownership is part of the WHERE clause: an eq against the caller id.
    const cond = whereCalls[0] as { args: unknown[] };
    const eqConds = cond.args.filter((c) => (c as { type?: string }).type === 'eq');
    const boundToCaller = eqConds.some((c) => (c as { b: unknown }).b === callerId);
    expect(boundToCaller).toBe(true);
  });
});
