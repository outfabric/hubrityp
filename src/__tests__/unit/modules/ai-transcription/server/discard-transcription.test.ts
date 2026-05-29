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
vi.mock('@/shared/db/schema/medical-records/tables', () => ({
  auditLog: { __table: 'audit_log' },
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
// DB mock — transaction with an update + audit insert; plus a follow-up select
// ---------------------------------------------------------------------------

let txUpdateReturning: Array<{ id: string }> = [];
let probeSelectResult: Array<{ id: string }> = [];
const auditInsertValues: Array<Record<string, unknown>> = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve(txUpdateReturning)),
            })),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((v: Record<string, unknown>) => {
            auditInsertValues.push(v);
            return Promise.resolve();
          }),
        })),
      };
      return cb(tx);
    }),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(probeSelectResult)),
        })),
      })),
    })),
  },
}));

import { discardTranscriptionImpl } from '@/modules/ai-transcription/server/discard-transcription';

function makeSupabase(userId: string | null): SupabaseClient {
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  txUpdateReturning = [];
  probeSelectResult = [];
  auditInsertValues.length = 0;
});

describe('discardTranscriptionImpl', () => {
  it('returns UNAUTHORIZED for an anonymous caller', async () => {
    const result = await discardTranscriptionImpl(makeSupabase(null), {
      transcriptionId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('marks the row reviewed and writes a PII-free audit row on success', async () => {
    const userId = randomUUID();
    const transcriptionId = randomUUID();
    txUpdateReturning = [{ id: transcriptionId }];

    const result = await discardTranscriptionImpl(makeSupabase(userId), { transcriptionId });

    expect(result).toEqual({ ok: true });
    expect(auditInsertValues.length).toBe(1);

    const audit = auditInsertValues[0]!;
    expect(audit).toMatchObject({
      userId,
      action: 'ai_transcription_discarded',
      resourceType: 'ai_transcription',
      resourceId: transcriptionId,
      metadata: {},
    });
    // No PII anywhere in the audit payload.
    expect(JSON.stringify(audit)).not.toMatch(/name|cpf|email/i);
  });

  it('is idempotent: second call (already reviewed) returns ALREADY_REVIEWED, no audit row', async () => {
    txUpdateReturning = []; // status predicate excluded the already-reviewed row
    probeSelectResult = [{ id: randomUUID() }]; // row exists, just not discardable

    const result = await discardTranscriptionImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
    });

    expect(result).toEqual({ ok: false, code: 'ALREADY_REVIEWED' });
    expect(auditInsertValues.length).toBe(0);
  });

  it('returns NOT_FOUND for a cross-tenant / missing id', async () => {
    txUpdateReturning = [];
    probeSelectResult = []; // owner-scoped probe finds nothing

    const result = await discardTranscriptionImpl(makeSupabase(randomUUID()), {
      transcriptionId: randomUUID(),
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(auditInsertValues.length).toBe(0);
  });
});
