import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle operator stubs
// ---------------------------------------------------------------------------

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
}));

vi.mock('@/shared/db/schema/ai-transcription/tables', () => ({
  aiTranscriptionSettings: new Proxy(
    {},
    { get: (_t, prop) => `ai_transcription_settings.${String(prop)}` },
  ),
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
// DB mock — insert(...).onConflictDoNothing(...) + select(...).where(...).limit()
// ---------------------------------------------------------------------------

const insertedValues: Array<Record<string, unknown>> = [];
let selectResult: Array<Record<string, unknown>> = [];

const insertMock = vi.fn(() => ({
  values: vi.fn((v: Record<string, unknown>) => {
    insertedValues.push(v);
    return {
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
    };
  }),
}));

const selectMock = vi.fn(() => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn(() => Promise.resolve(selectResult)),
    })),
  })),
}));

vi.mock('@/shared/db/client', () => ({
  db: {
    insert: (...args: unknown[]) => insertMock(...(args as [])),
    select: (...args: unknown[]) => selectMock(...(args as [])),
  },
}));

import { getTranscriptionSettingsImpl } from '@/modules/ai-transcription/server/get-transcription-settings';

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
  insertedValues.length = 0;
  selectResult = [];
});

describe('getTranscriptionSettingsImpl', () => {
  it('returns UNAUTHORIZED for an anonymous caller', async () => {
    const result = await getTranscriptionSettingsImpl(makeSupabase(null));
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('inserts the default row on first call and returns the synthesized defaults', async () => {
    const userId = randomUUID();
    // First call: the row was just inserted, so the read returns it with defaults.
    selectResult = [
      {
        enabled: false,
        defaultTemplate: 'livre',
        keepAudioHours: 24,
        keepTranscription: false,
        riskDetectionSensitivity: 'medium',
      },
    ];

    const result = await getTranscriptionSettingsImpl(makeSupabase(userId));

    expect(result).toEqual({
      ok: true,
      enabled: false,
      defaultTemplate: 'livre',
      keepAudioHours: 24,
      keepTranscription: false,
      riskDetectionSensitivity: 'medium',
    });

    // The upsert was keyed on the session user id, with the table defaults.
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      userId,
      enabled: false,
      defaultTemplate: 'livre',
      keepAudioHours: 24,
      keepTranscription: false,
      riskDetectionSensitivity: 'medium',
    });
  });

  it('reads the existing row on a subsequent call (upsert is a no-op)', async () => {
    const userId = randomUUID();
    selectResult = [
      {
        enabled: true,
        defaultTemplate: 'tcc',
        keepAudioHours: 24,
        keepTranscription: true,
        riskDetectionSensitivity: 'high',
      },
    ];

    const result = await getTranscriptionSettingsImpl(makeSupabase(userId));

    expect(result).toEqual({
      ok: true,
      enabled: true,
      defaultTemplate: 'tcc',
      keepAudioHours: 24,
      keepTranscription: true,
      riskDetectionSensitivity: 'high',
    });
  });
});
