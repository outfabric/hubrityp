import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';

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
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-purge-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
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
  status: 'failed' | 'cancelled' | 'ready' | 'pending';
  audioObjectKey: string | null;
  audioDiscardedAt?: Date | null;
  completedAt?: Date | null;
  updatedAt: Date;
  createdAt: Date;
}): Promise<void> {
  await runAsService(async (db) => {
    const createdIso = opts.createdAt.toISOString();
    const updatedIso = opts.updatedAt.toISOString();
    const completedIso = opts.completedAt ? opts.completedAt.toISOString() : null;
    const discardedIso = opts.audioDiscardedAt ? opts.audioDiscardedAt.toISOString() : null;
    await db.execute(
      dsql`INSERT INTO ai_transcriptions (id, user_id, patient_id, source, status, audio_object_key, audio_discarded_at, completed_at, created_at, updated_at)
           VALUES (${opts.id}, ${opts.userId}, ${opts.patientId}, 'manual_upload', ${opts.status},
                   ${opts.audioObjectKey}, ${discardedIso},
                   ${completedIso}, ${createdIso}, ${updatedIso})`,
    );
  });
}

// ---------------------------------------------------------------------------
// Dynamic import (after mocks)
// ---------------------------------------------------------------------------

let handler: (ctx: { step: unknown }) => Promise<{
  processed: number;
  purged: number;
  failed: number;
}>;

beforeAll(async () => {
  const mod = await import('@/modules/ai-transcription/inngest/purge-failed-audios');
  handler = mod.purgeFailedAudios as unknown as typeof handler;
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
    await db.execute(
      dsql`DELETE FROM patients WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-purge-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-purge-%@example.com'`);
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

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('purgeFailedAudios — integration (real Postgres + mock Storage)', () => {
  // -----------------------------------------------------------------------
  // Failed audio purged when terminal timestamp > 1h ago
  // -----------------------------------------------------------------------

  it('purges audio from a failed transcription older than 1 hour', async () => {
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
      status: 'failed',
      audioObjectKey: objectKey,
      completedAt: hoursAgo(2), // completed 2 hours ago — should be purged
      updatedAt: hoursAgo(2),
      createdAt: hoursAgo(3),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(1);
    expect(result.purged).toBe(1);
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
  // Cancelled audio purged when terminal timestamp > 1h ago
  // -----------------------------------------------------------------------

  it('purges audio from a cancelled transcription older than 1 hour', async () => {
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
      status: 'cancelled',
      audioObjectKey: objectKey,
      completedAt: null, // cancelled rows may not have completed_at
      updatedAt: hoursAgo(2), // COALESCE falls back to updated_at
      createdAt: hoursAgo(3),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(1);
    expect(result.purged).toBe(1);

    expect(storageRemoveCalls).toHaveLength(1);
    expect(storageRemoveCalls[0]!.paths).toEqual([objectKey]);
  });

  // -----------------------------------------------------------------------
  // Recent failure NOT purged (terminal timestamp < 1h ago)
  // -----------------------------------------------------------------------

  it('does NOT purge a recent failure (terminal timestamp < 1h)', async () => {
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
      status: 'failed',
      audioObjectKey: objectKey,
      completedAt: minutesAgo(30), // only 30 minutes ago — too recent
      updatedAt: minutesAgo(30),
      createdAt: hoursAgo(1),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(0);
    expect(result.purged).toBe(0);
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
  // Non-terminal status rows are NOT purged
  // -----------------------------------------------------------------------

  it('does NOT purge rows with non-terminal status (ready)', async () => {
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
      status: 'ready',
      audioObjectKey: objectKey,
      completedAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
      createdAt: hoursAgo(3),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(0);
    expect(storageRemoveCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Mixed: both failed and cancelled, old and recent — correct selection
  // -----------------------------------------------------------------------

  it('selects only old failed/cancelled rows, ignoring recent ones and non-terminal', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Old failed — should be purged
    const oldFailedId = randomUUID();
    await seedTranscriptionRow({
      id: oldFailedId,
      userId,
      patientId,
      status: 'failed',
      audioObjectKey: `${userId}/${oldFailedId}.webm`,
      completedAt: hoursAgo(3),
      updatedAt: hoursAgo(3),
      createdAt: hoursAgo(4),
    });

    // Old cancelled — should be purged
    const oldCancelledId = randomUUID();
    await seedTranscriptionRow({
      id: oldCancelledId,
      userId,
      patientId,
      status: 'cancelled',
      audioObjectKey: `${userId}/${oldCancelledId}.webm`,
      completedAt: null,
      updatedAt: hoursAgo(2),
      createdAt: hoursAgo(3),
    });

    // Recent failed — should NOT be purged
    const recentFailedId = randomUUID();
    await seedTranscriptionRow({
      id: recentFailedId,
      userId,
      patientId,
      status: 'failed',
      audioObjectKey: `${userId}/${recentFailedId}.webm`,
      completedAt: minutesAgo(15),
      updatedAt: minutesAgo(15),
      createdAt: minutesAgo(30),
    });

    // Old ready — should NOT be purged (non-terminal)
    const oldReadyId = randomUUID();
    await seedTranscriptionRow({
      id: oldReadyId,
      userId,
      patientId,
      status: 'ready',
      audioObjectKey: `${userId}/${oldReadyId}.webm`,
      completedAt: hoursAgo(5),
      updatedAt: hoursAgo(5),
      createdAt: hoursAgo(6),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    // Only the two old terminal rows should be processed
    expect(result.processed).toBe(2);
    expect(result.purged).toBe(2);

    expect(storageRemoveCalls).toHaveLength(2);
    const purgedPaths = storageRemoveCalls.flatMap((c) => c.paths);
    expect(purgedPaths).toContain(`${userId}/${oldFailedId}.webm`);
    expect(purgedPaths).toContain(`${userId}/${oldCancelledId}.webm`);

    // Verify unpurged rows still have their audio keys
    const { sql: sqlClient, db } = openClient();
    try {
      const [recentRow] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioDiscardedAt: aiTranscriptions.audioDiscardedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, recentFailedId));

      expect(recentRow!.audioObjectKey).not.toBeNull();
      expect(recentRow!.audioDiscardedAt).toBeNull();

      const [readyRow] = await db
        .select({
          audioObjectKey: aiTranscriptions.audioObjectKey,
          audioDiscardedAt: aiTranscriptions.audioDiscardedAt,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, oldReadyId));

      expect(readyRow!.audioObjectKey).not.toBeNull();
      expect(readyRow!.audioDiscardedAt).toBeNull();
    } finally {
      await sqlClient.end();
    }
  });

  // -----------------------------------------------------------------------
  // Row with no audio_object_key is skipped
  // -----------------------------------------------------------------------

  it('skips rows where audio_object_key is already NULL', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscriptionRow({
      id: transcriptionId,
      userId,
      patientId,
      status: 'failed',
      audioObjectKey: null, // already cleared
      completedAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
      createdAt: hoursAgo(3),
    });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(0);
    expect(storageRemoveCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Storage failure on one row does not block the other
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
      status: 'failed',
      audioObjectKey: failKey,
      completedAt: hoursAgo(2),
      updatedAt: hoursAgo(2),
      createdAt: hoursAgo(3),
    });

    const successId = randomUUID();
    const successKey = `${userId}/${successId}.webm`;
    await seedTranscriptionRow({
      id: successId,
      userId,
      patientId,
      status: 'cancelled',
      audioObjectKey: successKey,
      completedAt: null,
      updatedAt: hoursAgo(3),
      createdAt: hoursAgo(4),
    });

    // Make one specific path fail
    storageRemovePerPathError.set(failKey, { message: 'object not found' });

    const step = buildStepContext();
    const result = await handler({ step });

    expect(result.processed).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.failed).toBe(1);

    // The successful row should be marked purged in DB
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
});
