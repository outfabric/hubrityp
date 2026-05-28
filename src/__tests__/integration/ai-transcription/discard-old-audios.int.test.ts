import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  aiTranscriptionSettings,
  aiTranscriptions,
} from '@/shared/db/schema/ai-transcription/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Mock: Supabase Storage SDK — track deletes, no real Storage in Testcontainers
// ---------------------------------------------------------------------------

const storageRemoveCalls: Array<{ bucket: string; paths: string[] }> = [];
let storageRemoveError: { message: string } | null = null;
/** Per-path error map: if a path is in this map, its remove call returns an error. */
const storageRemovePerPathError = new Map<string, { message: string }>();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn((bucket: string) => ({
        remove: vi.fn((paths: string[]) => {
          storageRemoveCalls.push({ bucket, paths });

          // Check per-path errors
          for (const p of paths) {
            const err = storageRemovePerPathError.get(p);
            if (err) {
              return Promise.resolve({ data: null, error: err });
            }
          }

          if (storageRemoveError) {
            return Promise.resolve({ data: null, error: storageRemoveError });
          }
          return Promise.resolve({
            data: paths.map((name) => ({ name })),
            error: null,
          });
        }),
      })),
    },
  })),
}));

// ---------------------------------------------------------------------------
// Mock: Inngest client — returns the handler directly
// ---------------------------------------------------------------------------

vi.mock('@/modules/ai-transcription/inngest/client', () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
    createFunction: vi.fn((_config: unknown, handler: unknown) => handler),
  },
}));

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    // Use provider:"google" so handle_new_user trigger skips auto-profile
    // creation (which requires fullName in metadata for email provider).
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-discard-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  const { patients } = await import('@/shared/db/schema/patients/tables');
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: 'Test Patient',
    });
  });
}

async function seedTranscriptionRow(opts: {
  id: string;
  userId: string;
  patientId: string;
  audioObjectKey: string | null;
  audioDiscardedAt?: Date | null;
  createdAt: Date;
}): Promise<void> {
  await runAsService(async (db) => {
    // Use ISO strings for timestamps — postgres-js raw params choke on Date objects.
    const createdIso = opts.createdAt.toISOString();
    const discardedIso = opts.audioDiscardedAt ? opts.audioDiscardedAt.toISOString() : null;
    await db.execute(
      dsql`INSERT INTO ai_transcriptions (id, user_id, patient_id, source, status, audio_object_key, audio_discarded_at, created_at, updated_at)
           VALUES (${opts.id}, ${opts.userId}, ${opts.patientId}, 'manual_upload', 'ready',
                   ${opts.audioObjectKey}, ${discardedIso},
                   ${createdIso}, ${createdIso})`,
    );
  });
}

async function seedSettings(userId: string, keepAudioHours: number): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptionSettings).values({
      userId,
      enabled: true,
      keepAudioHours,
    });
  });
}

// ---------------------------------------------------------------------------
// Dynamic import (after mocks)
// ---------------------------------------------------------------------------

let handler: (ctx: { step: unknown }) => Promise<{
  processed: number;
  discarded: number;
  failed: number;
}>;

beforeAll(async () => {
  const mod = await import('@/modules/ai-transcription/inngest/discard-old-audios');
  handler = mod.discardOldAudios as unknown as typeof handler;
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  storageRemoveCalls.length = 0;
  storageRemoveError = null;
  storageRemovePerPathError.clear();

  await runAsService(async (db) => {
    await db.delete(aiTranscriptions);
    await db.delete(aiTranscriptionSettings);
    await db.execute(
      dsql`DELETE FROM patients WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-discard-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-discard-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// Step context builder
// ---------------------------------------------------------------------------

function buildStepContext() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discardOldAudios — integration (real Postgres + mock Storage)', () => {
  // -----------------------------------------------------------------------
  // Default 24h threshold: row older than 24h is discarded
  // -----------------------------------------------------------------------

  it('discards audio older than 24h when no per-user setting exists', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const objectKey = `${userId}/${transcriptionId}.webm`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscriptionRow({
      id: transcriptionId,
      userId,
      patientId,
      audioObjectKey: objectKey,
      createdAt: hoursAgo(25), // 25 hours ago — should be discarded
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(1);
    expect(result.discarded).toBe(1);
    expect(result.failed).toBe(0);

    // Verify Storage was called with correct path
    expect(storageRemoveCalls).toHaveLength(1);
    expect(storageRemoveCalls[0]!.paths).toEqual([objectKey]);

    // Verify DB row was updated
    const { sql: sqlClient, db } = openClient();
    try {
      const [row] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioDiscardedAt: aiTranscriptions.audioDiscardedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(row).toBeDefined();
      expect(row!.audioObjectKey).toBeNull();
      expect(row!.audioDiscardedAt).toBeInstanceOf(Date);
    } finally {
      await sqlClient.end();
    }
  });

  // -----------------------------------------------------------------------
  // Audio younger than threshold is kept
  // -----------------------------------------------------------------------

  it('does NOT discard audio younger than 24h (default threshold)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    const objectKey = `${userId}/${transcriptionId}.webm`;

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscriptionRow({
      id: transcriptionId,
      userId,
      patientId,
      audioObjectKey: objectKey,
      createdAt: hoursAgo(12), // 12 hours ago — too recent
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(0);
    expect(result.discarded).toBe(0);
    expect(storageRemoveCalls).toHaveLength(0);

    // Verify DB row was NOT updated
    const { sql: sqlClient, db } = openClient();
    try {
      const [row] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioDiscardedAt: aiTranscriptions.audioDiscardedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));

      expect(row!.audioObjectKey).toBe(objectKey);
      expect(row!.audioDiscardedAt).toBeNull();
    } finally {
      await sqlClient.end();
    }
  });

  // -----------------------------------------------------------------------
  // Per-user keep_audio_hours honored
  // -----------------------------------------------------------------------

  it('respects per-user keep_audio_hours setting (72h)', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedSettings(userId, 72); // 72 hours retention

    // Row at 50h — should NOT be discarded (within 72h window)
    const youngId = randomUUID();
    await seedTranscriptionRow({
      id: youngId,
      userId,
      patientId,
      audioObjectKey: `${userId}/${youngId}.webm`,
      createdAt: hoursAgo(50),
    });

    // Row at 73h — should be discarded
    const oldId = randomUUID();
    await seedTranscriptionRow({
      id: oldId,
      userId,
      patientId,
      audioObjectKey: `${userId}/${oldId}.webm`,
      createdAt: hoursAgo(73),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(1);
    expect(result.discarded).toBe(1);

    // Only the old row should have been deleted from Storage
    expect(storageRemoveCalls).toHaveLength(1);
    expect(storageRemoveCalls[0]!.paths[0]).toContain(oldId);

    // Verify young row is untouched
    const { sql: sqlClient, db } = openClient();
    try {
      const [youngRow] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioDiscardedAt: aiTranscriptions.audioDiscardedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, youngId));

      expect(youngRow!.audioObjectKey).not.toBeNull();
      expect(youngRow!.audioDiscardedAt).toBeNull();
    } finally {
      await sqlClient.end();
    }
  });

  // -----------------------------------------------------------------------
  // Storage delete failure on one row does not block others
  // -----------------------------------------------------------------------

  it('continues processing when Storage delete fails for one row', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const failId = randomUUID();
    const failKey = `${userId}/${failId}.webm`;
    await seedTranscriptionRow({
      id: failId,
      userId,
      patientId,
      audioObjectKey: failKey,
      createdAt: hoursAgo(25),
    });

    const successId = randomUUID();
    const successKey = `${userId}/${successId}.webm`;
    await seedTranscriptionRow({
      id: successId,
      userId,
      patientId,
      audioObjectKey: successKey,
      createdAt: hoursAgo(26),
    });

    // Make one specific path fail
    storageRemovePerPathError.set(failKey, { message: 'object not found' });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(2);
    expect(result.discarded).toBe(1);
    expect(result.failed).toBe(1);

    // The successful row should be marked discarded in DB
    const { sql: sqlClient, db } = openClient();
    try {
      const [successRow] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioDiscardedAt: aiTranscriptions.audioDiscardedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, successId));

      expect(successRow!.audioObjectKey).toBeNull();
      expect(successRow!.audioDiscardedAt).toBeInstanceOf(Date);

      // The failed row should still have its audio key
      const [failRow] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioDiscardedAt: aiTranscriptions.audioDiscardedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, failId));

      expect(failRow!.audioObjectKey).toBe(failKey);
      expect(failRow!.audioDiscardedAt).toBeNull();
    } finally {
      await sqlClient.end();
    }
  });

  // -----------------------------------------------------------------------
  // Row already discarded is skipped
  // -----------------------------------------------------------------------

  it('skips rows that already have audio_discarded_at set', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscriptionRow({
      id: transcriptionId,
      userId,
      patientId,
      audioObjectKey: null, // audio_object_key already cleared
      audioDiscardedAt: new Date(), // already discarded
      createdAt: hoursAgo(48),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(0);
    expect(storageRemoveCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // EXPLAIN: query uses the partial index
  // -----------------------------------------------------------------------

  it('query uses an index scan (not seq scan) on ai_transcriptions', async () => {
    // With few rows the planner may prefer a sequential scan. Disable seq
    // scan for this session to prove the planner CAN use an index.
    //
    // The planner may pick the partial index idx_ai_transcriptions_audio_to_discard
    // OR the composite idx_ai_transcriptions_user_created (which covers user_id
    // for the JOIN and created_at for the filter). Both are valid — the
    // dedicated data-layer test validates the partial index in isolation.
    const { sql: sqlClient, db } = openClient();
    try {
      await db.execute(dsql`SET enable_seqscan = off`);

      const explainRows = await db.execute<{ 'QUERY PLAN': string }>(
        dsql`EXPLAIN (FORMAT TEXT)
             SELECT t.id, t.audio_object_key
             FROM ai_transcriptions t
             LEFT JOIN ai_transcription_settings s ON s.user_id = t.user_id
             WHERE t.audio_object_key IS NOT NULL
               AND t.audio_discarded_at IS NULL
               AND t.created_at < now() - make_interval(hours => COALESCE(s.keep_audio_hours, 24))`,
      );

      const plan = explainRows.map((r) => r['QUERY PLAN']).join('\n');

      // Accept either the partial index or the composite index — both avoid
      // a full table scan. The key invariant: no Seq Scan on ai_transcriptions.
      const usesIndex =
        plan.includes('idx_ai_transcriptions_audio_to_discard') ||
        plan.includes('idx_ai_transcriptions_user_created');
      expect(usesIndex, `Expected an index scan on ai_transcriptions.\nPlan:\n${plan}`).toBe(true);

      const hasSeqScan = plan.includes('Seq Scan on ai_transcriptions');
      expect(hasSeqScan, 'query plan should not contain Seq Scan on ai_transcriptions').toBe(false);
    } finally {
      await sqlClient.end();
    }
  });

  // -----------------------------------------------------------------------
  // Mixed users with different retention settings
  // -----------------------------------------------------------------------

  it('handles mixed users with different retention settings', async () => {
    const userA = randomUUID();
    const patientA = randomUUID();
    const userB = randomUUID();
    const patientB = randomUUID();

    await seedAuthUser(userA);
    await seedPatient(userA, patientA);
    await seedSettings(userA, 48); // User A: 48h retention

    await seedAuthUser(userB);
    await seedPatient(userB, patientB);
    // User B: no settings — defaults to 24h

    // User A: 30h old — within A's 48h window, should NOT discard
    const rowA = randomUUID();
    await seedTranscriptionRow({
      id: rowA,
      userId: userA,
      patientId: patientA,
      audioObjectKey: `${userA}/${rowA}.webm`,
      createdAt: hoursAgo(30),
    });

    // User B: 30h old — exceeds B's 24h default, SHOULD discard
    const rowB = randomUUID();
    await seedTranscriptionRow({
      id: rowB,
      userId: userB,
      patientId: patientB,
      audioObjectKey: `${userB}/${rowB}.webm`,
      createdAt: hoursAgo(30),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(1);
    expect(result.discarded).toBe(1);

    // Only user B's row should have been processed
    expect(storageRemoveCalls).toHaveLength(1);
    expect(storageRemoveCalls[0]!.paths[0]).toContain(rowB);
  });
});
