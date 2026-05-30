import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle operator stubs
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
  gte: (a: unknown, b: unknown) => ({ type: 'gte', a, b }),
  // The action calls `sql<T>\`...\`` as a tagged template; return a marker.
  sql: Object.assign(
    (strings: TemplateStringsArray, ...exprs: unknown[]) => ({ type: 'sql', strings, exprs }),
    {},
  ),
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
// DB mock — four parallel `select().from().where()` chains. Each `where()`
// call resolves to the next queued result, in the order the action issues them:
//   1) counts (total, failed)
//   2) month (month)
//   3) review (reviewed, saved, acceptedWithoutEdits)
//   4) cost (avgCost)
// ---------------------------------------------------------------------------

let resultQueue: Array<Array<Record<string, unknown>>> = [];

vi.mock('@/shared/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(resultQueue.shift() ?? [])),
      })),
    })),
  },
}));

import { getTranscriptionStatsImpl } from '@/modules/ai-transcription/server/get-transcription-stats';

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
  resultQueue = [];
});

describe('getTranscriptionStatsImpl', () => {
  it('returns UNAUTHORIZED for an anonymous caller', async () => {
    const result = await getTranscriptionStatsImpl(makeSupabase(null));
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
  });

  it('empty user → all zeros and null derived fields', async () => {
    resultQueue = [
      [{ total: 0, failed: 0 }],
      [{ month: 0 }],
      [{ reviewed: 0, saved: 0, acceptedWithoutEdits: 0 }],
      [{ avgCost: null }],
    ];

    const result = await getTranscriptionStatsImpl(makeSupabase(randomUUID()));

    expect(result).toEqual({
      ok: true,
      totalProcessed: 0,
      monthProcessed: 0,
      reviewed: 0,
      savedToProntuario: 0,
      estimatedMinutesSaved: 0,
      acceptanceRatePercent: null,
      avgCostUsd: null,
      failedCount: 0,
    });
  });

  it('full user with 10 reviewed / 7 saved-without-edits → acceptance 70%', async () => {
    resultQueue = [
      [{ total: 12, failed: 1 }],
      [{ month: 4 }],
      [{ reviewed: 10, saved: 8, acceptedWithoutEdits: 7 }],
      [{ avgCost: 0.0123 }],
    ];

    const result = await getTranscriptionStatsImpl(makeSupabase(randomUUID()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalProcessed).toBe(12);
    expect(result.failedCount).toBe(1);
    expect(result.monthProcessed).toBe(4);
    expect(result.estimatedMinutesSaved).toBe(32); // 4 * 8
    expect(result.reviewed).toBe(10);
    expect(result.savedToProntuario).toBe(8);
    expect(result.acceptanceRatePercent).toBe(70); // round(100 * 7/10)
    expect(result.avgCostUsd).toBeCloseTo(0.0123, 4);
  });

  it('reviewed < 5 → acceptance rate withheld (null)', async () => {
    resultQueue = [
      [{ total: 4, failed: 0 }],
      [{ month: 4 }],
      [{ reviewed: 4, saved: 4, acceptedWithoutEdits: 4 }], // would be 100% if counted
      [{ avgCost: 0.01 }],
    ];

    const result = await getTranscriptionStatsImpl(makeSupabase(randomUUID()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.acceptanceRatePercent).toBeNull();
  });

  it('avgCostUsd is passed through (averaged in SQL)', async () => {
    resultQueue = [
      [{ total: 2, failed: 0 }],
      [{ month: 2 }],
      [{ reviewed: 0, saved: 0, acceptedWithoutEdits: 0 }],
      [{ avgCost: 0.25 }], // avg of e.g. 0.20 and 0.30
    ];

    const result = await getTranscriptionStatsImpl(makeSupabase(randomUUID()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.avgCostUsd).toBeCloseTo(0.25, 4);
  });
});
