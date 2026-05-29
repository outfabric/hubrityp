import { randomUUID } from 'node:crypto';

import { eq, sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import { openClient } from '../setup/db';
import { runAsService } from '../setup/run-as-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAuthUser(userId: string): Promise<void> {
  await runAsService(async (db) => {
    await db.execute(
      dsql`INSERT INTO auth.users (id, email, raw_app_meta_data)
           VALUES (${userId}, ${`test-${userId}@example.com`}, '{"provider":"google"}'::jsonb)
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

async function seedTranscription(userId: string, patientId: string): Promise<string> {
  const id = randomUUID();
  await runAsService(async (db) => {
    await db.insert(aiTranscriptions).values({
      id,
      userId,
      patientId,
      source: 'manual_upload',
      status: 'ready',
    });
  });
  return id;
}

afterEach(async () => {
  // Clean in reverse FK order, scoped to test users. `evolutions` references
  // `ai_transcriptions` (ON DELETE SET NULL), so the order between them does
  // not cause FK violations, but we delete evolutions first for clarity.
  await runAsService(async (db) => {
    await db.execute(
      dsql`DELETE FROM evolutions
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM ai_transcriptions
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(
      dsql`DELETE FROM patients
           WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'test-%@example.com')`,
    );
    await db.execute(dsql`DELETE FROM auth.users WHERE email LIKE 'test-%@example.com'`);
  });
});

// ---------------------------------------------------------------------------
// (a) Defaults: ai_assisted = false, ai_transcription_id = NULL
// ---------------------------------------------------------------------------

describe('evolutions AI flags — defaults', () => {
  it('a new evolution defaults ai_assisted to false and ai_transcription_id to NULL', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    const evolutionId = randomUUID();
    const row = await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evolutionId,
        userId,
        patientId,
        templateType: 'livre',
        content: { text: 'note' },
        // Intentionally omit ai_assisted / ai_transcription_id to exercise the
        // column defaults.
      });
      const [inserted] = await db.select().from(evolutions).where(eq(evolutions.id, evolutionId));
      return inserted;
    });

    expect(row?.aiAssisted).toBe(false);
    expect(row?.aiTranscriptionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (b) FK ON DELETE SET NULL — deleting the transcription nulls the backlink
//     without dropping the evolution.
// ---------------------------------------------------------------------------

describe('evolutions AI flags — FK ON DELETE SET NULL', () => {
  it('deleting the source transcription nulls ai_transcription_id and keeps the evolution', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);
    const transcriptionId = await seedTranscription(userId, patientId);

    const evolutionId = randomUUID();
    await runAsService(async (db) => {
      await db.insert(evolutions).values({
        id: evolutionId,
        userId,
        patientId,
        templateType: 'livre',
        content: { text: 'note from AI' },
        aiAssisted: true,
        aiTranscriptionId: transcriptionId,
      });
    });

    // Delete the transcription — ON DELETE SET NULL must clear the FK column.
    await runAsService(async (db) => {
      await db.delete(aiTranscriptions).where(eq(aiTranscriptions.id, transcriptionId));
    });

    const row = await runAsService(async (db) => {
      const [found] = await db.select().from(evolutions).where(eq(evolutions.id, evolutionId));
      return found;
    });

    // Evolution survives the transcription deletion (Lei 13.787/2018 retention).
    expect(row).toBeDefined();
    expect(row?.id).toBe(evolutionId);
    // Backlink is nulled, ai_assisted is unchanged.
    expect(row?.aiTranscriptionId).toBeNull();
    expect(row?.aiAssisted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) EXPLAIN of the audit/statistics query uses the new composite index.
//
// With a small dataset the planner may prefer a Seq Scan. We disable seq scan
// in a dedicated session to force the planner to pick any usable index — this
// proves `idx_evolutions_user_ai_assisted` covers the query shape.
// ---------------------------------------------------------------------------

describe('evolutions AI flags — index usage', () => {
  it('EXPLAIN of WHERE user_id = X AND ai_assisted = true uses idx_evolutions_user_ai_assisted', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Populate the table so the planner has statistics to work with.
    await runAsService(async (db) => {
      const rows = [];
      for (let i = 0; i < 20; i++) {
        rows.push({
          id: randomUUID(),
          userId,
          patientId,
          templateType: 'livre',
          content: { text: `note ${i}` },
          aiAssisted: i % 2 === 0,
        });
      }
      await db.insert(evolutions).values(rows);
      await db.execute(dsql`ANALYZE evolutions`);
    });

    const { sql, db } = openClient();
    try {
      await db.execute(dsql.raw(`SET enable_seqscan = off;`));

      const explainResult = await db.execute(
        dsql`EXPLAIN (FORMAT JSON) SELECT id
             FROM evolutions
             WHERE user_id = ${userId} AND ai_assisted = true`,
      );

      const planJson = JSON.stringify(explainResult);

      expect(planJson, 'query plan should use idx_evolutions_user_ai_assisted').toContain(
        'idx_evolutions_user_ai_assisted',
      );

      const hasSeqScan = planJson.includes('"Seq Scan"') && planJson.includes('"evolutions"');
      expect(hasSeqScan, 'query plan should not contain a Seq Scan on evolutions').toBe(false);
    } finally {
      await sql.end();
    }
  });
});
