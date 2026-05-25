import { randomUUID } from 'node:crypto';

import { sql as dsql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { aiTranscriptions } from '@/shared/db/schema/ai-transcription/tables';
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

afterEach(async () => {
  // Clean in reverse FK order, scoped to test users.
  await runAsService(async (db) => {
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
// Verify the partial index is used by the discard cron query pattern.
//
// With a small dataset the planner may choose Seq Scan over the index. We
// disable seq_scan within a session-scoped SET to force the planner to pick
// any available index — this proves the index is usable for the query shape.
// ---------------------------------------------------------------------------

describe('ai-transcription discard index usage', () => {
  it('EXPLAIN uses idx_ai_transcriptions_audio_to_discard and not Seq Scan on ai_transcriptions', async () => {
    const userId = randomUUID();
    const patientId = randomUUID();
    await seedAuthUser(userId);
    await seedPatient(userId, patientId);

    // Insert a mix of rows to populate the table so the planner has stats.
    await runAsService(async (db) => {
      const rows = [];
      for (let i = 0; i < 20; i++) {
        rows.push({
          id: randomUUID(),
          userId,
          patientId,
          source: 'manual_upload' as const,
          status: 'pending' as const,
          // Mix: some with audio, some without, some already discarded.
          audioObjectKey: i < 10 ? `${userId}/${randomUUID()}/audio.webm` : null,
          audioDiscardedAt: i < 5 ? new Date() : null,
        });
      }
      await db.insert(aiTranscriptions).values(rows);
    });

    // Run ANALYZE so the planner has up-to-date statistics.
    await runAsService(async (db) => {
      await db.execute(dsql`ANALYZE ai_transcriptions`);
    });

    // Use a dedicated connection with `enable_seqscan = off` to force the
    // planner to use the index. This proves the index covers the query shape
    // without requiring a large dataset.
    const { sql, db } = openClient();
    try {
      await db.execute(dsql.raw(`SET enable_seqscan = off;`));

      const explainResult = await db.execute(
        dsql`EXPLAIN (FORMAT JSON) SELECT id, audio_object_key, created_at
             FROM ai_transcriptions
             WHERE audio_object_key IS NOT NULL
               AND audio_discarded_at IS NULL
             ORDER BY created_at`,
      );

      const planJson = JSON.stringify(explainResult);

      // With seq scan disabled, the planner MUST use the partial index.
      expect(planJson, 'query plan should use idx_ai_transcriptions_audio_to_discard').toContain(
        'idx_ai_transcriptions_audio_to_discard',
      );

      // The plan should NOT contain a Seq Scan on ai_transcriptions.
      const hasSeqScan =
        planJson.includes('"Seq Scan"') && planJson.includes('"ai_transcriptions"');
      expect(hasSeqScan, 'query plan should not contain a Seq Scan on ai_transcriptions').toBe(
        false,
      );
    } finally {
      await sql.end();
    }
  });
});
