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
// DB mock — db.transaction(cb) with a tx exposing select / insert
// ---------------------------------------------------------------------------

const SETTINGS_ID = randomUUID();

// The "old" row returned by the in-transaction read. `null` simulates a
// first-ever save (no existing row).
let oldRow: Record<string, unknown> | null = null;

// Captured rows passed to the *audit* insert (the second insert in the tx).
let auditInsertValues: Array<Record<string, unknown>> = [];
let settingsUpsertCount = 0;

vi.mock('@/shared/db/client', () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(oldRow ? [oldRow] : [])),
            })),
          })),
        })),
        insert: vi.fn((table: { __table?: string }) => {
          // The settings upsert path: values -> onConflictDoUpdate -> returning.
          // The audit path: values(rows[]) resolving to void.
          const isAudit = table?.__table === 'audit_log';
          return {
            values: vi.fn((v: Record<string, unknown> | Array<Record<string, unknown>>) => {
              if (isAudit) {
                auditInsertValues = Array.isArray(v) ? v : [v];
                return Promise.resolve();
              }
              settingsUpsertCount += 1;
              return {
                onConflictDoUpdate: vi.fn(() => ({
                  returning: vi.fn(() => Promise.resolve([{ id: SETTINGS_ID }])),
                })),
              };
            }),
          };
        }),
      };
      return cb(tx);
    }),
  },
}));

import { updateTranscriptionSettingsImpl } from '@/modules/ai-transcription/server/update-transcription-settings';

function makeSupabase(userId: string | null): SupabaseClient {
  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
}

const BASE_INPUT = {
  enabled: false,
  defaultTemplate: 'livre' as const,
  riskDetectionSensitivity: 'medium' as const,
  keepAudioHours: 24 as const,
  keepTranscription: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  oldRow = null;
  auditInsertValues = [];
  settingsUpsertCount = 0;
});

describe('updateTranscriptionSettingsImpl', () => {
  it('returns UNAUTHORIZED for an anonymous caller', async () => {
    const result = await updateTranscriptionSettingsImpl(makeSupabase(null), BASE_INPUT);
    expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(settingsUpsertCount).toBe(0);
  });

  it('rejects invalid input with INVALID_INPUT (no write)', async () => {
    const result = await updateTranscriptionSettingsImpl(makeSupabase(randomUUID()), {
      ...BASE_INPUT,
      keepAudioHours: 72, // not allowed by the literal(24) schema
    });
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(settingsUpsertCount).toBe(0);
  });

  it('emits ai_transcription_enabled when enabling (false → true)', async () => {
    oldRow = { enabled: false, keepAudioHours: 24, keepTranscription: false };

    const result = await updateTranscriptionSettingsImpl(makeSupabase(randomUUID()), {
      ...BASE_INPUT,
      enabled: true,
    });

    expect(result).toEqual({ ok: true });
    const actions = auditInsertValues.map((a) => a.action);
    expect(actions).toContain('ai_transcription_enabled');
    expect(actions).not.toContain('ai_transcription_disabled');
  });

  it('emits ai_transcription_disabled when disabling (true → false)', async () => {
    oldRow = { enabled: true, keepAudioHours: 24, keepTranscription: false };

    const result = await updateTranscriptionSettingsImpl(makeSupabase(randomUUID()), {
      ...BASE_INPUT,
      enabled: false,
    });

    expect(result).toEqual({ ok: true });
    const actions = auditInsertValues.map((a) => a.action);
    expect(actions).toContain('ai_transcription_disabled');
    expect(actions).not.toContain('ai_transcription_enabled');
  });

  it('emits keep_transcription_toggled when keepTranscription flips', async () => {
    oldRow = { enabled: false, keepAudioHours: 24, keepTranscription: false };

    const result = await updateTranscriptionSettingsImpl(makeSupabase(randomUUID()), {
      ...BASE_INPUT,
      keepTranscription: true,
    });

    expect(result).toEqual({ ok: true });
    const actions = auditInsertValues.map((a) => a.action);
    expect(actions).toContain('ai_transcription_keep_transcription_toggled');
  });

  it('emits NO audit on an idempotent re-save (no value change)', async () => {
    oldRow = { enabled: false, keepAudioHours: 24, keepTranscription: false };

    const result = await updateTranscriptionSettingsImpl(makeSupabase(randomUUID()), BASE_INPUT);

    expect(result).toEqual({ ok: true });
    expect(settingsUpsertCount).toBe(1); // upsert still happens
    expect(auditInsertValues).toHaveLength(0); // but no audit row
  });

  it('keys the upsert and audit on the session user id, never the input (no forgery)', async () => {
    const sessionUserId = randomUUID();
    const forgedUserId = randomUUID();
    oldRow = { enabled: false, keepAudioHours: 24, keepTranscription: false };

    const result = await updateTranscriptionSettingsImpl(makeSupabase(sessionUserId), {
      ...BASE_INPUT,
      enabled: true,
      // attacker tries to attribute the change to someone else
      userId: forgedUserId,
    });

    expect(result).toEqual({ ok: true });
    expect(auditInsertValues).toHaveLength(1);
    expect(auditInsertValues[0]!.userId).toBe(sessionUserId);
    expect(JSON.stringify(auditInsertValues[0])).not.toContain(forgedUserId);
  });

  it('audit payload carries no PII (only userId / oldValue / newValue)', async () => {
    const userId = randomUUID();
    oldRow = { enabled: false, keepAudioHours: 24, keepTranscription: false };

    await updateTranscriptionSettingsImpl(makeSupabase(userId), { ...BASE_INPUT, enabled: true });

    const audit = auditInsertValues[0]!;
    expect(audit).toMatchObject({
      userId,
      action: 'ai_transcription_enabled',
      resourceType: 'ai_transcription_settings',
      resourceId: SETTINGS_ID,
      metadata: { userId, oldValue: false, newValue: true },
    });
    expect(JSON.stringify(audit)).not.toMatch(/name|cpf|email|patient/i);
  });
});
