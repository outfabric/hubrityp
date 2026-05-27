import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`status-enum-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
           ON CONFLICT (id) DO NOTHING`,
    );
  });
}

async function seedPatient(userId: string, patientId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(patients).values({
      id: patientId,
      userId,
      fullName: `Patient ${patientId.slice(0, 8)}`,
    });
  });
}

async function seedTranscription(
  userId: string,
  patientId: string,
  transcriptionId: string,
): Promise<void> {
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id: transcriptionId,
      userId,
      patientId,
      source: 'manual_upload',
      status: 'pending',
    });
  });
}

afterEach(async () => {
  await runAsService(async (db) => {
    await db.execute(
      dsql`DELETE FROM ai_transcriptions
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'status-enum-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM patients
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'status-enum-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'status-enum-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// (a) UPDATE to `cancelled` is accepted by the CHECK constraint
// ---------------------------------------------------------------------------

describe('ai-transcription status enum — cancelled status', () => {
  it('UPDATE to cancelled is accepted', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription(userId, patientId, transcriptionId);

    await runAsService(async (db) => {
      await db
        .update(aiTranscriptions)
        .set({ status: 'cancelled' })
        .where(eq(aiTranscriptions.id, transcriptionId));
    });

    const rows = await runAsService(async (db) => {
      return db
        .select({ status: aiTranscriptions.status })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// (b) UPDATE to `archived` is rejected by the CHECK constraint
// ---------------------------------------------------------------------------

describe('ai-transcription status enum — invalid status', () => {
  it('UPDATE to archived is rejected by CHECK constraint', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription(userId, patientId, transcriptionId);

    await expect(
      runAsService(async (db) => {
        await db
          .update(aiTranscriptions)
          .set({ status: 'archived' })
          .where(eq(aiTranscriptions.id, transcriptionId));
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (c) Cost columns default to NULL
// ---------------------------------------------------------------------------

describe('ai-transcription cost columns — defaults', () => {
  it('transcription_cost_usd and llm_cost_usd default to NULL', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription(userId, patientId, transcriptionId);

    const rows = await runAsService(async (db) => {
      return db
        .select({
          transcriptionCostUsd: aiTranscriptions.transcriptionCostUsd,
          llmCostUsd: aiTranscriptions.llmCostUsd,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.transcriptionCostUsd).toBeNull();
    expect(rows[0]!.llmCostUsd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) Cost columns accept decimal values
// ---------------------------------------------------------------------------

describe('ai-transcription cost columns — decimal values', () => {
  it('cost columns accept decimal values and round-trip correctly', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    const transcriptionId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    await seedTranscription(userId, patientId, transcriptionId);

    await runAsService(async (db) => {
      await db
        .update(aiTranscriptions)
        .set({
          transcriptionCostUsd: '0.0123',
          llmCostUsd: '1.5678',
        })
        .where(eq(aiTranscriptions.id, transcriptionId));
    });

    const rows = await runAsService(async (db) => {
      return db
        .select({
          transcriptionCostUsd: aiTranscriptions.transcriptionCostUsd,
          llmCostUsd: aiTranscriptions.llmCostUsd,
        })
        .from(aiTranscriptions)
        .where(eq(aiTranscriptions.id, transcriptionId));
    });

    expect(rows).toHaveLength(1);
    // Drizzle returns numeric as string to preserve precision.
    expect(rows[0]!.transcriptionCostUsd).toBe('0.0123');
    expect(rows[0]!.llmCostUsd).toBe('1.5678');
  });
});
