import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { sql as dsql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

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
           VALUES (${userId}, ${`test-consent-revoked-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
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
      fullName: 'Test Patient Consent',
    });
  });
}

/**
 * Seed a transcription row with a specific status.
 * Uses raw SQL to bypass CHECK constraint issues with Drizzle's insert
 * when status values need to be precisely set.
 */
async function seedTranscriptionRow(opts: {
  id: string;
  userId: string;
  patientId: string;
  status: string;
}): Promise<void> {
  await runAsService(async (db) => {
    const now = new Date().toISOString();
    await db.execute(
      dsql`INSERT INTO ai_transcriptions (id, user_id, patient_id, source, status, created_at, updated_at)
           VALUES (${opts.id}, ${opts.userId}, ${opts.patientId}, 'manual_upload', ${opts.status}, ${now}, ${now})`,
    );
  });
}

// ---------------------------------------------------------------------------
// Dynamic import (after mocks)
// ---------------------------------------------------------------------------

type HandlerFn = (ctx: {
  event: { data: Record<string, unknown> };
  step: { run: (name: string, fn: () => unknown) => Promise<unknown> };
}) => Promise<{ cancelled: number; skippedMidProcessing: number }>;

let handler: HandlerFn;

beforeAll(async () => {
  const mod = await import('@/modules/ai-transcription/inngest/on-consent-revoked');
  handler = mod.onConsentRevoked as unknown as HandlerFn;
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await runAsService(async (db) => {
    await db.delete(aiTranscriptions);
    await db.execute(
      dsql`DELETE FROM patients WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-consent-revoked-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM auth.users WHERE email LIKE 'test-consent-revoked-%@example.com'`,
    );
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
// Tests
// ---------------------------------------------------------------------------

describe('onConsentRevoked — integration (real Postgres)', () => {
  it('seeds 4 rows (pending, transcribing, generating, ready) and asserts each outcome', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    const pendingId = randomUUID();
    const transcribingId = randomUUID();
    const generatingId = randomUUID();
    const readyId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    await seedTranscriptionRow({ id: pendingId, userId, patientId, status: 'pending' });
    await seedTranscriptionRow({
      id: transcribingId,
      userId,
      patientId,
      status: 'transcribing',
    });
    await seedTranscriptionRow({ id: generatingId, userId, patientId, status: 'generating' });
    await seedTranscriptionRow({ id: readyId, userId, patientId, status: 'ready' });

    const step = buildStepContext();
    const result = await handler({
      event: {
        data: {
          termId: randomUUID(),
          userId,
          patientId,
          revokedAt: new Date().toISOString(),
          reason: null,
        },
      },
      step,
    });

    // The handler should have cancelled 1 (pending) and skipped 2 (transcribing, generating).
    // The 'ready' row is not returned by findInFlightRows so not counted.
    expect(result.cancelled).toBe(1);
    expect(result.skippedMidProcessing).toBe(2);

    // Verify each row's outcome in the real DB
    const { sql: sqlClient, db } = openClient();
    try {
      // pending → cancelled with error_code 'consent_revoked'
      const [pendingRow] = await db
        .select({
          status: aiTranscriptions.status,
          errorCode: aiTranscriptions.errorCode,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, pendingId));

      expect(pendingRow).toBeDefined();
      expect(pendingRow!.status).toBe('cancelled');
      expect(pendingRow!.errorCode).toBe('consent_revoked');

      // transcribing → unchanged
      const [transcribingRow] = await db
        .select({
          status: aiTranscriptions.status,
          errorCode: aiTranscriptions.errorCode,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcribingId));

      expect(transcribingRow).toBeDefined();
      expect(transcribingRow!.status).toBe('transcribing');
      expect(transcribingRow!.errorCode).toBeNull();

      // generating → unchanged
      const [generatingRow] = await db
        .select({
          status: aiTranscriptions.status,
          errorCode: aiTranscriptions.errorCode,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, generatingId));

      expect(generatingRow).toBeDefined();
      expect(generatingRow!.status).toBe('generating');
      expect(generatingRow!.errorCode).toBeNull();

      // ready → unchanged (not touched by the handler at all)
      const [readyRow] = await db
        .select({
          status: aiTranscriptions.status,
          errorCode: aiTranscriptions.errorCode,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, readyId));

      expect(readyRow).toBeDefined();
      expect(readyRow!.status).toBe('ready');
      expect(readyRow!.errorCode).toBeNull();
    } finally {
      await sqlClient.end();
    }
  });

  it('does not affect rows belonging to a different patient', async () => {
    const userId = randomUUID();
    const patientA = randomUUID();
    const patientB = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientA);
    await seedPatient(userId, patientB);

    const rowA = randomUUID();
    const rowB = randomUUID();

    await seedTranscriptionRow({ id: rowA, userId, patientId: patientA, status: 'pending' });
    await seedTranscriptionRow({ id: rowB, userId, patientId: patientB, status: 'pending' });

    const step = buildStepContext();
    // Revoke consent only for patient A
    const result = await handler({
      event: {
        data: {
          termId: randomUUID(),
          userId,
          patientId: patientA,
          revokedAt: new Date().toISOString(),
          reason: null,
        },
      },
      step,
    });

    expect(result.cancelled).toBe(1);

    const { sql: sqlClient, db } = openClient();
    try {
      // Patient A's row → cancelled
      const [rowAResult] = await db
        .select({ status: aiTranscriptions.status })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, rowA));

      expect(rowAResult!.status).toBe('cancelled');

      // Patient B's row → still pending
      const [rowBResult] = await db
        .select({ status: aiTranscriptions.status })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, rowB));

      expect(rowBResult!.status).toBe('pending');
    } finally {
      await sqlClient.end();
    }
  });

  it('does not affect rows belonging to a different user', async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    const patientId = randomUUID();

    await seedAuthUser(userA);
    await seedAuthUser(userB);
    await seedPatient(userA, patientId);

    // Need a separate patient for user B (patients are scoped to users)
    const patientForB = randomUUID();
    await seedPatient(userB, patientForB);

    const rowA = randomUUID();
    const rowB = randomUUID();

    await seedTranscriptionRow({ id: rowA, userId: userA, patientId, status: 'pending' });
    await seedTranscriptionRow({
      id: rowB,
      userId: userB,
      patientId: patientForB,
      status: 'pending',
    });

    const step = buildStepContext();
    // Revoke consent only for user A
    await handler({
      event: {
        data: {
          termId: randomUUID(),
          userId: userA,
          patientId,
          revokedAt: new Date().toISOString(),
          reason: null,
        },
      },
      step,
    });

    const { sql: sqlClient, db } = openClient();
    try {
      const [rowBResult] = await db
        .select({ status: aiTranscriptions.status })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, rowB));

      expect(rowBResult!.status).toBe('pending');
    } finally {
      await sqlClient.end();
    }
  });

  it('handles no in-flight rows gracefully', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();

    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Only seed a 'reviewed' row — not returned by findInFlightRows
    const reviewedId = randomUUID();
    await runAsService(async (db) => {
      const now = new Date().toISOString();
      await db.execute(
        dsql`INSERT INTO ai_transcriptions (id, user_id, patient_id, source, status, reviewed_at, created_at, updated_at)
             VALUES (${reviewedId}, ${userId}, ${patientId}, 'manual_upload', 'reviewed', ${now}, ${now}, ${now})`,
      );
    });

    const step = buildStepContext();
    const result = await handler({
      event: {
        data: {
          termId: randomUUID(),
          userId,
          patientId,
          revokedAt: new Date().toISOString(),
          reason: null,
        },
      },
      step,
    });

    expect(result.cancelled).toBe(0);
    expect(result.skippedMidProcessing).toBe(0);

    // Reviewed row should be untouched
    const { sql: sqlClient, db } = openClient();
    try {
      const [row] = await db
        .select({ status: aiTranscriptions.status })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, reviewedId));

      expect(row!.status).toBe('reviewed');
    } finally {
      await sqlClient.end();
    }
  });
});
